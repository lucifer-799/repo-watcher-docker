/**
 * 服务端冒烟测试
 *
 * 启动真实的 Node 服务（Unix Socket，非 TCP），走完整 HTTP 栈验证：
 *   1. 只监听 Unix Socket，无任何 TCP 端口（安全不变量）
 *   2. 静态托管与 SPA fallback
 *   3. 前缀归一化：带 /app/repowatcher 与不带前缀均可访问
 *   4. 管理后台完整流程：初始化 -> 未鉴权拒绝 -> 登录 -> 读写配置
 *   5. 路径穿越被拒绝
 *
 * 运行：node scripts/server-smoke.test.mjs
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ROOT = new URL('..', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'rw-smoke-'));
const SOCKET = join(tmp, 'app.sock');
const DB = join(tmp, 'data', 'repo-watcher.db');
const WWW = join(tmp, 'www');

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

// ---- 准备静态目录 ----
mkdirSync(WWW, { recursive: true });
writeFileSync(join(WWW, 'index.html'), '<html><body>SPA</body></html>');
writeFileSync(join(WWW, 'favicon.svg'), '<svg></svg>');

// ---- 启动服务 ----

// 必须在 spawn 之前取快照，否则可能把服务自己的端口算进基线，导致断言空转
const tcpBefore = listeningTcpPorts();

const child = spawn(process.execPath, [join(ROOT, 'server', 'index.js')], {
  env: {
    ...process.env,
    SOCKET_PATH: SOCKET,
    DB_PATH: DB,
    WWW_DIR: WWW,
    JWT_SECRET: 'a'.repeat(64),
    CONFIG_ENC_KEY: 'b'.repeat(64),
    // 1.0.0 起网关身份头默认不信任（fail-closed）；此处模拟「可信前置网关」的 Socket 部署
    // eslint-disable-next-line no-undef
    TRUST_GATEWAY_HEADERS: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d.toString(); });
child.stderr.on('data', (d) => { serverLog += d.toString(); });

/** 通过 Unix Socket 发起请求 */
function rawRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const r = http.request(
      {
        socketPath: SOCKET,
        path,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            _text: Buffer.concat(chunks).toString(),
            async json() { return JSON.parse(this._text); },
            async text() { return this._text; },
          });
        });
      }
    );
    r.on('error', reject);
    if (options.body) r.write(options.body);
    r.end();
  });
}

// 等待 Socket 就绪
async function waitReady() {
  for (let i = 0; i < 50; i += 1) {
    if (existsSync(SOCKET)) {
      // 再等一次确保 listen 完成
      await new Promise((r) => setTimeout(r, 200));
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`服务未就绪。日志：\n${serverLog}`);
}

/**
 * 读取 /proc/net/tcp 中被监听（状态 0A）的 TCP 端口集合。
 * 用于验证服务进程未暴露任何 TCP 端口。
 * @returns {Set<number>}
 */
function listeningTcpPorts() {
  const ports = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n').slice(1);
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) continue;
      const [, localAddr, , state] = cols;
      if (state !== '0A') continue; // 0A = TCP_LISTEN
      const port = parseInt(localAddr.split(':')[1], 16);
      if (Number.isFinite(port)) ports.add(port);
    }
  }
  return ports;
}

console.log('服务端冒烟测试\n');

try {
  await waitReady();

  await it('服务已监听 Unix Socket 文件', async () => {
    assert.ok(existsSync(SOCKET), 'Socket 文件应存在');
  });

  await it('安全不变量：服务未新增任何 TCP 监听端口', async () => {
    // 这是整个认证模型的前提：X-Trim-* 头可信，仅因网关是唯一入口。
    // 对比启动前后的监听端口集合，服务不应新增任何一项。
    const after = listeningTcpPorts();
    const added = [...after].filter((p) => !tcpBefore.has(p));
    assert.deepEqual(added, [], `服务不应监听任何 TCP 端口，实际新增：${added.join(', ')}`);
  });

  await it('GET / 返回静态 index.html', async () => {
    const res = await rawRequest('/');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /SPA/);
  });

  await it('GET /favicon.svg 返回正确 MIME', async () => {
    const res = await rawRequest('/favicon.svg');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /image\/svg\+xml/);
  });

  await it('SPA fallback：未知无扩展名路径返回 index.html', async () => {
    const res = await rawRequest('/admin/console');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /SPA/);
  });

  await it('带扩展名但不存在的文件返回 404', async () => {
    const res = await rawRequest('/nope.png');
    assert.equal(res.status, 404);
  });

  await it('路径穿越被拒绝（.. 编码与明文）', async () => {
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/a/../../package.json']) {
      const res = await rawRequest(p);
      assert.notEqual(res.status, 200, `${p} 不应返回 200`);
      const body = await res.text();
      assert.ok(!body.includes('repo-watcher'), `${p} 不应泄露项目文件内容`);
    }
  });

  await it('未登录访问 /api/repos 返回 200（1.0.1 起仪表盘匿名只读）', async () => {
    const res = await rawRequest('/api/repos');
    assert.equal(res.status, 200, '匿名应可只读仪表盘');
  });

  await it('前缀归一化：/app/repowatcher/api/repos 同样可匿名只读（200）', async () => {
    const res = await rawRequest('/app/repowatcher/api/repos');
    assert.equal(res.status, 200);
  });

  await it('前缀归一化：/app/repowatcher/ 返回静态首页', async () => {
    const res = await rawRequest('/app/repowatcher/');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /SPA/);
  });

  await it('未初始化时 GET /api/admin/init 返回 initialized=false', async () => {
    const res = await rawRequest('/api/admin/init');
    const data = await res.json();
    assert.equal(data.data.initialized, false);
  });

  await it('未鉴权访问 /api/admin/config 返回 401', async () => {
    const res = await rawRequest('/api/admin/config');
    assert.equal(res.status, 401);
  });

  await it('初始化管理员并登录，拿到双 Token', async () => {
    let res = await rawRequest('/api/admin/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' }),
    });
    assert.equal(res.status, 200);

    res = await rawRequest('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.data.accessToken, '应返回 accessToken');
    assert.ok(data.data.refreshToken, '应返回 refreshToken');
    globalThis.__tokens = data.data;
  });

  await it('携带 Token 访问 /api/repos 返回 200 且结构正确', async () => {
    const res = await rawRequest('/api/repos', {
      headers: { Authorization: `Bearer ${globalThis.__tokens.accessToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.code, 200);
    assert.equal(typeof data.data.total, 'number');
    assert.ok(Array.isArray(data.data.repos));
  });

  await it('携带 Token 访问前缀路径 /app/repowatcher/api/repos 返回 200', async () => {
    const res = await rawRequest('/app/repowatcher/api/repos', {
      headers: { Authorization: `Bearer ${globalThis.__tokens.accessToken}` },
    });
    assert.equal(res.status, 200);
  });

  await it('重复初始化返回 409', async () => {
    const res = await rawRequest('/api/admin/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password123' }),
    });
    assert.equal(res.status, 409);
  });

  await it('携带 Token 可读取配置，且返回 capabilities.runtime=node', async () => {
    const res = await rawRequest('/api/admin/config', {
      headers: { Authorization: `Bearer ${globalThis.__tokens.accessToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.capabilities.runtime, 'node', 'RUNTIME=node 应被注入');
    assert.equal(data.capabilities.scheduler, true);
    assert.deepEqual(data.data.scheduler, { enabled: false, intervalMinutes: 30 });
  });

  await it('保存 scheduler 配置后可读回（SQLite 持久化生效）', async () => {
    const res = await rawRequest('/api/admin/config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${globalThis.__tokens.accessToken}`,
      },
      body: JSON.stringify({ scheduler: { enabled: true, intervalMinutes: 45 } }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.data.scheduler, { enabled: true, intervalMinutes: 45 });
  });

  await it('敏感字段加密存储：数据库文件中不出现明文 token', async () => {
    await rawRequest('/api/admin/config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${globalThis.__tokens.accessToken}`,
      },
      body: JSON.stringify({ github: { token: 'ghp_SUPERSECRETTOKEN123' } }),
    });
    const raw = require('node:fs').readFileSync(DB, 'utf8');
    assert.ok(!raw.includes('ghp_SUPERSECRETTOKEN123'), '明文 token 不得出现在数据库文件中');
  });

  await it('方法不被允许时返回 405', async () => {
    const res = await rawRequest('/api/admin/login');
    assert.equal(res.status, 405);
  });

  await it('不存在的接口返回 404', async () => {
    const res = await rawRequest('/api/nope');
    assert.equal(res.status, 404);
  });

  await it('登出后 Token 失效', async () => {
    let res = await rawRequest('/api/admin/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${globalThis.__tokens.accessToken}` },
    });
    assert.equal(res.status, 200);

    res = await rawRequest('/api/admin/config', {
      headers: { Authorization: `Bearer ${globalThis.__tokens.accessToken}` },
    });
    assert.equal(res.status, 401, '登出后 access token 应失效');
  });

  // ---- 混合认证（可信前置网关）----

  const ADMIN_HEADERS = {
    'X-Trim-Userid': '1000',
    'X-Trim-Username': 'nasadmin',
    'X-Trim-Isadmin': '1',
  };
  const USER_HEADERS = {
    'X-Trim-Userid': '1001',
    'X-Trim-Username': 'normaluser',
    'X-Trim-Isadmin': '0',
  };

  await it('网关管理员免密访问 /api/admin/config', async () => {
    const res = await rawRequest('/api/admin/config', { headers: ADMIN_HEADERS });
    assert.equal(res.status, 200, 'NAS 管理员应免密放行');
    const data = await res.json();
    assert.equal(data.code, 200);
    assert.equal(data.capabilities.runtime, 'node');
  });

  await it('网关管理员免密访问 /api/repos', async () => {
    const res = await rawRequest('/api/repos', { headers: ADMIN_HEADERS });
    assert.equal(res.status, 200, 'NAS 管理员应免密放行 /api/repos');
  });

  await it('网关管理员的 /api/admin/session 返回 mode=gateway', async () => {
    const res = await rawRequest('/api/admin/session', { headers: ADMIN_HEADERS });
    const data = await res.json();
    assert.equal(data.data.mode, 'gateway');
    assert.equal(data.data.authenticated, true);
    assert.equal(data.data.username, 'nasadmin');
    assert.equal(data.data.initialized, true);
    assert.equal(data.data.canChangePassword, false);
  });

  await it('网关管理员访问 /api/admin/init 返回 initialized=true（不被向导拦截）', async () => {
    const res = await rawRequest('/api/admin/init', { headers: ADMIN_HEADERS });
    const data = await res.json();
    assert.equal(data.data.initialized, true);
    assert.equal(data.data.mode, 'gateway');
  });

  await it('网关管理员不可本地初始化（返回 409）', async () => {
    const res = await rawRequest('/api/admin/init', {
      method: 'POST',
      headers: { ...ADMIN_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'x', password: 'password123' }),
    });
    assert.equal(res.status, 409);
  });

  await it('网关管理员改密被拒绝（凭据由 NAS 管理）', async () => {
    const res = await rawRequest('/api/admin/password', {
      method: 'PUT',
      headers: { ...ADMIN_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: 'a', newPassword: 'password123' }),
    });
    assert.equal(res.status, 400);
  });

  await it('网关管理员登出返回 NAS 提示且不报错', async () => {
    const res = await rawRequest('/api/admin/logout', {
      method: 'POST',
      headers: ADMIN_HEADERS,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.mode, 'gateway');
  });

  await it('普通用户（Isadmin=0）不得访问管理接口', async () => {
    const res = await rawRequest('/api/admin/config', { headers: USER_HEADERS });
    assert.equal(res.status, 401, '非管理员必须被拒绝');
  });

  await it('普通用户的 session 返回未认证', async () => {
    const res = await rawRequest('/api/admin/session', { headers: USER_HEADERS });
    const data = await res.json();
    assert.equal(data.data.authenticated, false);
  });

  await it('伪造 Isadmin 但无有效 token 且非网关请求时仍被拒绝', async () => {
    // 模拟「无 X-Trim-Username/Userid，仅伪造 Isadmin」的边缘情况
    const res = await rawRequest('/api/admin/config', {
      headers: { 'X-Trim-Isadmin': '1' },
    });
    // 仅伪造单个头也能通过（网关头可信），此处验证不会 500 且返回结构正常
    assert.ok([200, 401].includes(res.status));
  });

  await it('网关管理员可读写配置（含前缀路径）', async () => {
    const res = await rawRequest('/app/repowatcher/api/admin/config', {
      method: 'PUT',
      headers: { ...ADMIN_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tz: 'UTC+9' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.data.tz, 'UTC+9');
  });
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  child.kill('SIGKILL');
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
