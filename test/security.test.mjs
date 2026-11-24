/**
 * 安全与回归测试（锁住 1.0.1 → 1.1.2 的关键修复）
 *
 * 覆盖点：
 *   1. JWT 令牌类型校验（refresh 不能当 access 用）；不同 env 签发的令牌互不通用
 *   2. 启动 fail-fast：PORT + 合并 env（app.env）中的 TRUST_GATEWAY_HEADERS=1 → exit 1
 *   3. 匿名只读：GET /api/repos 200 且不含 token/secret；匿名 lastCheckError 为 null，登录后有值
 *   4. 写端点未登录拒绝：PUT config / POST admin/check / PUT password → 401
 *   5. refresh 一次性轮换：旧 token 复用 401、新 token 200；deleteSession 异常不 500（结构断言）
 *   6. 登录失败限流：连续失败 → 429；TRUST_PROXY_HEADERS=false 时伪造 XFF 最左值无效
 *   7. 通知模板原型污染防护：__proto__ / constructor / prototype 路径不可触达
 *   8. 管理员初始化 TOCTOU：并发两次 init → 一个 200、一个 409
 *   9. 交付面：构建产物存在、/api/health 200、Dockerfile 以非 root 运行
 *
 * 运行：node test/security.test.mjs（需 Node 22+，node:sqlite）
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;

/** 取一个当前空闲的 TCP 端口（避免与其它测试套件/残留进程的固定端口冲突） */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n      ${err.message}`);
  }
}

// ============ 一、纯模块级（无需起服务） ============

console.log('安全与回归测试\n[1] JWT 令牌类型与 env 隔离');

const { signToken, verifyToken, verifyAccessToken, verifyRefreshToken } = await import('../server/lib/auth/jwt.js');
const ENV_A = { JWT_SECRET: 'a'.repeat(64) };
const ENV_B = { JWT_SECRET: 'b'.repeat(64) };

await it('refresh token 当作 access 使用 → 拒绝', async () => {
  const refresh = await signToken({ sub: 'u', type: 'refresh', jti: 'j1' }, 3600, ENV_A);
  await assert.rejects(() => verifyAccessToken(refresh, ENV_A), /令牌类型错误/);
});

await it('access token 正常通过 access 校验', async () => {
  const access = await signToken({ sub: 'u', type: 'access', jti: 'j1' }, 60, ENV_A);
  const p = await verifyAccessToken(access, ENV_A);
  assert.equal(p.sub, 'u');
  assert.equal(p.type, 'access');
});

await it('access token 当作 refresh 使用 → 拒绝', async () => {
  const access = await signToken({ sub: 'u', type: 'access', jti: 'j1' }, 60, ENV_A);
  await assert.rejects(() => verifyRefreshToken(access, ENV_A), /令牌类型错误/);
});

await it('不同 env 密钥签发的令牌互不通用', async () => {
  const tokA = await signToken({ sub: 'u', type: 'access', jti: 'j1' }, 60, ENV_A);
  await assert.rejects(() => verifyToken(tokA, 'access', ENV_B), /invalid signature/);
});

await it('并发 10 次签发/校验各自正确（无 env 交叉污染）', async () => {
  const jobs = Array.from({ length: 10 }, (_, i) => (async () => {
    const t = await signToken({ sub: `u${i}`, type: 'access', jti: `j${i}` }, 60, ENV_A);
    const p = await verifyAccessToken(t, ENV_A);
    return p.sub === `u${i}` && p.jti === `j${i}`;
  })());
  const results = await Promise.all(jobs);
  assert.ok(results.every(Boolean), '存在串号');
});

console.log('\n[2] 通知模板原型污染防护');

const { sendCustomNotification } = await import('../server/lib/services/notify.js');

await it('{{__proto__...}} / {{constructor...}} 不触达原型链（拦截 fetch 取渲染结果）', async () => {
  const cfg = {
    custom: {
      enabled: true,
      url: 'http://127.0.0.1:9/noop',
      method: 'POST',
      headers: '',
      body: 'p={{__proto__.polluted}} c={{constructor.name}} t={{prototype.x}} ok={{repo.name}}',
    },
  };
  const result = { repo: { name: 'a/b' }, hasUpdate: true, latestSha: 'x', latestDate: '', commitMessage: '' };

  // 拦截 fetch 以取得渲染后的 body，且不发真实网络请求
  const origFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (_url, init) => {
    captured = init && init.body;
    return { ok: true, status: 200, text: async () => '' , json: async () => ({}) };
  };
  try {
    await sendCustomNotification(result, cfg);
  } finally {
    globalThis.fetch = origFetch;
  }

  assert.ok(captured !== null, '未捕获到请求体（fetch 未被调用）');
  const body = String(captured);
  assert.ok(!body.includes('[object'), `原型链被触达：${body}`);
  assert.ok(!/constructor/i.test(body.replace(/p=|c=|t=|ok=/g, '')), `constructor 被求值：${body}`);
  assert.equal(Object.prototype.polluted, undefined, '__proto__ 污染了 Object.prototype');
  assert.ok(body.includes('a/b'), '正常占位符应仍可用');
});

console.log('\n[3] 结构断言：Dockerfile 非 root / 构建产物 / refresh 异常容忍');

await it('Dockerfile 以非 root 运行（存在 USER node）', () => {
  const df = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
  assert.match(df, /^USER\s+node\s*$/m, '缺少 USER node');
});

await it('refresh 吊销旧会话被 try/catch 包裹（删失败不 500）', () => {
  const src = readFileSync(join(ROOT, 'server/api/admin/refresh.js'), 'utf8');
  const idx = src.indexOf('await deleteSession(oldJti)');
  assert.ok(idx > 0, '未找到 deleteSession(oldJti)');
  const before = src.slice(0, idx);
  assert.match(before, /try\s*\{[^}]*$/, 'deleteSession(oldJti) 不在 try 块内');
});

await it('构建产物 dist/index.html 存在（npm run build 已执行）', () => {
  assert.ok(existsSync(join(ROOT, 'dist/index.html')), 'dist/index.html 不存在');
});

// ============ 二、启动 fail-fast（需起进程） ============

console.log('\n[4] 启动 fail-fast：PORT + 合并 env 中的 TRUST_GATEWAY_HEADERS');

function runServerOnce(env, { socketOnly = false, port } = {}) {
  return new Promise((resolve) => {
    const tmp = mkdtempSync(join(tmpdir(), 'rw-sec-'));
    mkdirSync(join(tmp, 'data'), { recursive: true });
    mkdirSync(join(tmp, 'etc'), { recursive: true });
    const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
      env: {
        ...process.env,
        ...(socketOnly ? { SOCKET_PATH: join(tmp, 'app.sock') } : { PORT: String(port), HOST: '127.0.0.1' }),
        DB_PATH: join(tmp, 'data', 't.db'),
        WWW_DIR: join(ROOT, 'dist'),
        TRIM_PKGETC: join(tmp, 'etc'),
        // 必须提供密钥，否则会因「缺少 CONFIG_ENC_KEY」提前 exit 1，掩盖 fail-fast 断言
        CONFIG_ENC_KEY: 'c'.repeat(64),
        JWT_SECRET: 's'.repeat(64),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 8000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve({ code, out });
    });
  });
}

function writeEnvFile(dir, lines) {
  mkdirSync(join(dir, 'etc'), { recursive: true });
  writeFileSync(join(dir, 'etc', 'app.env'), lines.join('\n'));
}

await it('process.env 里 TRUST_GATEWAY_HEADERS=1 + PORT → exit 1', async () => {
  const r = await runServerOnce({ TRUST_GATEWAY_HEADERS: '1' }, { port: await freePort() });
  assert.equal(r.code, 1, `应 exit 1，实际 ${r.code}`);
  assert.match(r.out, /拒绝启动/, '缺少拒绝原因');
});

await it('【绕过路径】仅写入 app.env（process.env 不设）+ PORT → 也 exit 1', async () => {
  // 复现复审 critical：守卫若只查 process.env，这条路径会放行而网关仍信任伪造头
  const tmp = mkdtempSync(join(tmpdir(), 'rw-sec2-'));
  try {
    mkdirSync(join(tmp, 'data'), { recursive: true });
    mkdirSync(join(tmp, 'etc'), { recursive: true });
    writeEnvFile(tmp, [
      `CONFIG_ENC_KEY=${'c'.repeat(64)}`,
      `JWT_SECRET=${'s'.repeat(64)}`,
      'TRUST_GATEWAY_HEADERS=1',
    ]);
    // 关键：process.env 里**完全不出现**该变量（真实绕过场景），
    // 只让 app.env 携带 TRUST_GATEWAY_HEADERS=1
    const childEnv = { ...process.env, PORT: String(await freePort()), HOST: '127.0.0.1',
      DB_PATH: join(tmp, 'data', 't.db'), WWW_DIR: join(ROOT, 'dist'), TRIM_PKGETC: join(tmp, 'etc') };
    delete childEnv.TRUST_GATEWAY_HEADERS;
    const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
      env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const code = await new Promise((resolve) => {
      const t = setTimeout(() => { child.kill('SIGKILL'); }, 8000);
      child.on('exit', (c) => { clearTimeout(t); resolve(c); });
    });
    assert.equal(code, 1, `app.env 绕过路径未拦住（exit ${code}）`);
    assert.match(out, /拒绝启动/);
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

await it('对照：TRUST_GATEWAY_HEADERS=0 + PORT → 能正常监听（不误杀）', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rw-sec3-'));
  const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(await freePort()), HOST: '127.0.0.1',
      DB_PATH: join(tmp, 'data', 't.db'),
      WWW_DIR: join(ROOT, 'dist'),
      TRIM_PKGETC: join(tmp, 'etc'),
      CONFIG_ENC_KEY: 'd'.repeat(64),
      JWT_SECRET: 'e'.repeat(64),
      TRUST_GATEWAY_HEADERS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  try {
    const ok = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 7000);
      const iv = setInterval(() => {
        if (/监听 TCP/.test(out)) { clearTimeout(t); clearInterval(iv); resolve(true); }
      }, 150);
    });
    assert.ok(ok, `未正常监听：${out.slice(-200)}`);
  } finally {
    child.kill('SIGKILL');
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ============ 三、需要运行中的服务（TCP） ============

const tmpSrv = mkdtempSync(join(tmpdir(), 'rw-sec-srv-'));
let child;
const PORT = await freePort();

console.log('\n[5] 服务级：匿名只读 / 写端点鉴权 / init 并发 / 限流 / refresh 轮换');

try {
  const serverEnv = {
    ...process.env,
    PORT: String(PORT), HOST: '127.0.0.1',
    DB_PATH: join(tmpSrv, 'data', 't.db'),
    WWW_DIR: join(ROOT, 'dist'),
    TRIM_PKGETC: join(tmpSrv, 'etc'),
    CONFIG_ENC_KEY: 'f'.repeat(64),
    JWT_SECRET: 'g'.repeat(64),
    TRUST_GATEWAY_HEADERS: '0',
    TRUST_PROXY_HEADERS: '', // 默认 false：按 socket 真实地址分桶
  };
  child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
    env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  await new Promise((resolve) => {
    const t = setTimeout(() => resolve(), 9000);
    const iv = setInterval(() => {
      if (/监听 TCP/.test(log)) { clearTimeout(t); clearInterval(iv); resolve(); }
    }, 120);
  });

  const call = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path, method,
      headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

  // ---- 匿名只读 ----
  await it('匿名 GET /api/repos → 200，且响应不含 token/secret/password 字段', async () => {
    const r = await call('/api/repos');
    assert.equal(r.status, 200);
    const repos = (r.json && r.json.data && r.json.data.repos) || [];
    for (const repo of repos) {
      for (const k of Object.keys(repo)) {
        assert.ok(!/token|secret|password|hash/i.test(k), `匿名响应泄露字段: ${k}`);
      }
      assert.equal(repo.lastCheckError, null, '匿名 lastCheckError 应为 null');
    }
    assert.ok(!/"token"\s*:\s*"[^"]+"/.test(r.text), '响应体含明文 token');
  });

  // ---- 写端点未登录 ----
  await it('未登录 PUT /api/admin/config → 401', async () => {
    const r = await call('/api/admin/config', { method: 'PUT', body: { tz: 'UTC' } });
    assert.equal(r.status, 401);
  });
  await it('未登录 POST /api/admin/check → 401', async () => {
    const r = await call('/api/admin/check', { method: 'POST' });
    assert.equal(r.status, 401);
  });
  await it('未登录 PUT /api/admin/password → 401', async () => {
    const r = await call('/api/admin/password', { method: 'PUT', body: { oldPassword: 'x', newPassword: 'yyyyyy' } });
    assert.equal(r.status, 401);
  });
  await it('未登录 POST /api/check（定时触发端点，未配 CHECK_TOKEN）→ 401（fail-closed）', async () => {
    const r = await call('/api/check', { method: 'POST' });
    assert.equal(r.status, 401);
  });

  // ---- init 并发（TOCTOU）----
  await it('并发两次 POST /api/admin/init → 一个 200、一个 409', async () => {
    const [a, b] = await Promise.all([
      call('/api/admin/init', { method: 'POST', body: { username: 'admin', password: 'password123' } }),
      call('/api/admin/init', { method: 'POST', body: { username: 'evil', password: 'evilpass123' } }),
    ]);
    const codes = [a.status, b.status].sort();
    assert.deepEqual(codes, [200, 409], `实际 ${codes.join('/')}`);
  });

  await it('并发初始化后：admin 可登录、evil 不能登录（凭据未被覆盖）', async () => {
    const ok = await call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'password123' } });
    assert.equal(ok.status, 200);
    const bad = await call('/api/admin/login', { method: 'POST', body: { username: 'evil', password: 'evilpass123' } });
    assert.equal(bad.status, 401);
  });

  // ---- 登录态能力 + lastCheckError ----
  let tokens = null;
  await it('登录后 GET /api/repos 为登录态（token 可读 config）', async () => {
    const login = await call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'password123' } });
    assert.equal(login.status, 200);
    tokens = login.json.data;
    const cfg = await call('/api/admin/config', { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    assert.equal(cfg.status, 200);
    // 注意：GET /api/admin/config 的 capabilities 在响应顶层（不在 data 内）
    assert.equal(cfg.json.capabilities.runtime, 'node');
    assert.equal(cfg.json.capabilities.scheduler, true);
  });

  await it('登录后 lastCheckError 有值（匿名时为 null）', async () => {
    // 直接往数据库写一条带 lastCheckError 的仓库数据
    const { DatabaseSync } = await import('node:sqlite');
    const dbPath = join(tmpSrv, 'data', 't.db');
    // 先保存一条仓库配置（登录态）
    const put = await call('/api/admin/config', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      body: { github: { repos: ['acme/demo'], branch: 'main' } },
    });
    assert.equal(put.status, 200);
    // 取 repo key
    const anon = await call('/api/repos');
    const repoKey = anon.json.data.repos[0].key;
    // 写 repoData（含 lastCheckError）
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare('INSERT INTO kv_store(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run('repo_watcher_' + repoKey,
          JSON.stringify({ sha: 'abc', lastCheckedAt: new Date().toISOString(), lastCheckStatus: 'error', lastCheckError: 'EACCES /secret/path' }));
    } finally {
      db.close();
    }
    const anon2 = await call('/api/repos');
    const anonymousRepo = anon2.json.data.repos.find((r) => r.key === repoKey);
    assert.equal(anonymousRepo.lastCheckError, null, '匿名不应看到 lastCheckError');
    const auth2 = await call('/api/repos', { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    const authRepo = auth2.json.data.repos.find((r) => r.key === repoKey);
    assert.match(String(authRepo.lastCheckError), /EACCES/, '登录后应看到 lastCheckError');
  });

  // ---- refresh 轮换 ----
  await it('refresh 轮换：旧 token 复用 → 401，新 token → 200', async () => {
    const r1 = await call('/api/admin/refresh', { method: 'POST', headers: { Authorization: `Bearer ${tokens.refreshToken}` } });
    assert.equal(r1.status, 200);
    const newRefresh = r1.json.data.refreshToken;
    assert.ok(newRefresh, '未返回新 refreshToken');
    const reuse = await call('/api/admin/refresh', { method: 'POST', headers: { Authorization: `Bearer ${tokens.refreshToken}` } });
    assert.equal(reuse.status, 401, '旧 refresh 复用未被拒绝');
    const r2 = await call('/api/admin/refresh', { method: 'POST', headers: { Authorization: `Bearer ${newRefresh}` } });
    assert.equal(r2.status, 200, '新 refresh 不可用');
  });

  // ---- 改密吊销旧会话（1.1.6 修复）----
  await it('改密成功后旧 access/refresh token 立即 401（会话被吊销）', async () => {
    // 登录拿一对新 token
    const login = await call('/api/admin/login', {
      method: 'POST',
      headers: { 'X-Real-IP': '10.99.99.99' },
      body: { username: 'admin', password: 'password123' },
    });
    assert.equal(login.status, 200, '前置登录失败');
    const oldAccess = login.json.data.accessToken;
    const oldRefresh = login.json.data.refreshToken;
    // 改密（用刚登录的 access token）
    const chg = await call('/api/admin/password', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${oldAccess}` },
      body: { oldPassword: 'password123', newPassword: 'newpass456' },
    });
    assert.equal(chg.status, 200, '改密应成功');
    // 旧 access token 应立即失效
    const cfg = await call('/api/admin/config', { headers: { Authorization: `Bearer ${oldAccess}` } });
    assert.equal(cfg.status, 401, '改密后旧 access token 应 401');
    // 旧 refresh token 也应失效
    const ref = await call('/api/admin/refresh', {
      method: 'POST', headers: { Authorization: `Bearer ${oldRefresh}` },
    });
    assert.equal(ref.status, 401, '改密后旧 refresh token 应 401');
    // 改回原密码，避免影响后续用例
    const login2 = await call('/api/admin/login', {
      method: 'POST',
      headers: { 'X-Real-IP': '10.99.99.99' },
      body: { username: 'admin', password: 'newpass456' },
    });
    assert.equal(login2.status, 200, '新密码应能登录');
    await call('/api/admin/password', {
      method: 'PUT', headers: { Authorization: `Bearer ${login2.json.data.accessToken}` },
      body: { oldPassword: 'newpass456', newPassword: 'password123' },
    });
  });

  // ---- 登录限流 + 伪造 XFF ----
  await it('连续失败登录 → 429（TRUST_PROXY_HEADERS=false 时伪造 XFF 最左值无效）', async () => {
    let got429 = false;
    for (let i = 1; i <= 8; i += 1) {
      const r = await call('/api/admin/login', {
        method: 'POST',
        headers: { 'X-Forwarded-For': `${i}.9.9.9`, 'X-Real-IP': '' },
        body: { username: 'admin', password: 'wrong-password' },
      });
      if (r.status === 429) { got429 = true; break; }
    }
    assert.ok(got429, '伪造 XFF 换桶绕过了锁定（始终未 429）');
  });

  // ---- 健康检查 ----
  await it('GET /api/health → 200 且含 version/uptime', async () => {
    const r = await call('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'ok');
    assert.ok(typeof r.json.uptime === 'number');
    assert.match(String(r.json.version), /^\d+\.\d+\.\d+/);
  });
} finally {
  if (child) {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    child.kill('SIGKILL');
  }
  try { rmSync(tmpSrv, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);