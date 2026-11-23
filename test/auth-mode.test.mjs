/**
 * 混合认证模式测试
 *
 * 核心安全属性：X-Trim-* 头只在自托管 Node 运行时（RUNTIME=node）被信任。
 * 非 Node 运行时（或未显式开启信任）下必须完全忽略这些头，否则任何人都能伪造请求头提权为管理员。
 *
 * 运行：node scripts/auth-mode.test.mjs
 */

import assert from 'node:assert/strict';

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

// ---- 环境准备 ----

const memDriver = (() => {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async getJSON(k) { return store.has(k) ? JSON.parse(store.get(k)) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list(p) {
      return {
        keys: [...store.keys()].filter((x) => x.startsWith(p)).sort().map((name) => ({ name })),
        complete: true,
      };
    },
    async deletePrefix(p) {
      let n = 0;
      for (const k of [...store.keys()]) if (k.startsWith(p)) { store.delete(k); n += 1; }
      return n;
    },
  };
})();

const kv = await import('../server/lib/utils/kv.js');
kv.setStorageDriver(memDriver);

const { getGatewayPrincipal, isNodeRuntime } = await import(
  '../server/lib/auth/gateway.js'
);
const { requireAccess } = await import('../server/lib/auth/middleware.js');
const { initAdmin } = await import('../server/lib/auth/admin.js');
const { onRequestGet: reposGet } = await import('../server/api/repos.js');

// TRUST_GATEWAY_HEADERS='1' 模拟「可信网关前置」场景（1.0.0 起默认为关，必须显式开启才信任网关头）
const NODE_ENV = { RUNTIME: 'node', TRUST_GATEWAY_HEADERS: '1', JWT_SECRET: 'j'.repeat(64) };
// 无 RUNTIME 标记 = 非 Node 常驻进程（等价于「不识别网关头」的场景）
const NON_NODE_ENV = { JWT_SECRET: 'j'.repeat(64) };

const FAKE_ADMIN = {
  'X-Trim-Userid': '1000',
  'X-Trim-Username': 'attacker',
  'X-Trim-Isadmin': '1',
};

function req(headers = {}) {
  return new Request('http://localhost/api/admin/config', { headers });
}

console.log('混合认证模式测试\n');

// ---- 运行时判定 ----

await it('isNodeRuntime：RUNTIME=node 时为 true，未设置时为 false', () => {
  assert.equal(isNodeRuntime(NODE_ENV), true);
  assert.equal(isNodeRuntime(NON_NODE_ENV), false);
  assert.equal(isNodeRuntime(undefined), false);
});

// ---- 主体解析 ----

await it('Node 运行时解析网关头', () => {
  const p = getGatewayPrincipal(req(FAKE_ADMIN), NODE_ENV);
  assert.equal(p.isAdmin, true);
  assert.equal(p.username, 'attacker');
  assert.equal(p.present, true);
});

await it('非 Node 运行时完全忽略网关头（防伪造提权）', () => {
  const p = getGatewayPrincipal(req(FAKE_ADMIN), NON_NODE_ENV);
  assert.equal(p.isAdmin, false, '非 Node 运行时不得信任 X-Trim-Isadmin');
  assert.equal(p.present, false);
});

await it('Node 运行时缺少所有网关头时视为无主体', () => {
  const p = getGatewayPrincipal(req({}), NODE_ENV);
  assert.equal(p.present, false);
  assert.equal(p.isAdmin, false);
});

await it('Isadmin=0 时不得判定为管理员', () => {
  const p = getGatewayPrincipal(
    req({ 'X-Trim-Username': 'u', 'X-Trim-Isadmin': '0' }),
    NODE_ENV
  );
  assert.equal(p.isAdmin, false);
});

await it('Isadmin 为 "true"/"yes"/"2" 等非 "1" 值时不放行', () => {
  for (const v of ['true', 'yes', '2', '01', 'admin', '']) {
    const p = getGatewayPrincipal(req({ 'X-Trim-Isadmin': v }), NODE_ENV);
    assert.equal(p.isAdmin, false, `Isadmin=${v} 不应被当作管理员`);
  }
});

await it('Isadmin 前后空白由 Headers API 按 Fetch 规范裁剪后视为 "1"', () => {
  // Headers 构造会去除首尾空白（Fetch 规范），故 ' 1' 实际读到 '1'。
  // 这是标准行为而非漏洞：网关与浏览器都不会发出带空白的头值。
  for (const v of [' 1', '1 ', '\t1']) {
    const p = getGatewayPrincipal(req({ 'X-Trim-Isadmin': v }), NODE_ENV);
    assert.equal(p.isAdmin, true, `Isadmin=${JSON.stringify(v)} 经 Headers 规范化后应为 '1'`);
  }
});

// ---- requireAccess 分支 ----

await it('【关键】未识别网关身份时伪造 X-Trim-Isadmin 仍返回 401', async () => {
  const res = await requireAccess(req(FAKE_ADMIN), NON_NODE_ENV);
  assert.equal(res.ok, false, '伪造管理员头不得通过鉴权');
  assert.equal(res.status, 401);
});

await it('Node 部署下网关管理员通过鉴权，mode=gateway', async () => {
  const res = await requireAccess(req(FAKE_ADMIN), NODE_ENV);
  assert.equal(res.ok, true);
  assert.equal(res.mode, 'gateway');
});

await it('Node 部署下普通用户被拒绝', async () => {
  const res = await requireAccess(
    req({ 'X-Trim-Username': 'u', 'X-Trim-Isadmin': '0' }),
    NODE_ENV
  );
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
});

await it('无任何凭据时被拒绝', async () => {
  const res = await requireAccess(req({}), NODE_ENV);
  assert.equal(res.ok, false);
});

await it('无效 token 在 Node 下回落网关分支，非管理员仍被拒', async () => {
  const res = await requireAccess(
    req({ Authorization: 'Bearer invalid.token.here', 'X-Trim-Isadmin': '0' }),
    NODE_ENV
  );
  assert.equal(res.ok, false);
});

await it('密码模式：初始化后可用 token 通过，mode=password', async () => {
  await initAdmin('admin', 'password123');

  const { issueTokens } = await import('../server/lib/auth/jwt.js');
  const { saveSession } = await import('../server/lib/auth/admin.js');
  const { accessToken, jti } = await issueTokens('admin', NODE_ENV);
  await saveSession(jti);

  const res = await requireAccess(
    req({ Authorization: `Bearer ${accessToken}` }),
    NODE_ENV
  );
  assert.equal(res.ok, true);
  assert.equal(res.mode, 'password', '有效 JWT 应优先走密码模式');
});

// ---- /api/repos 鉴权（锁定后需令牌）----

await it('【关键】/api/repos 未携带令牌也能读取（1.0.1 起仪表盘匿名只读），但不含敏感字段', async () => {
  const res = await reposGet({ request: req({}), env: NON_NODE_ENV });
  assert.equal(res.status, 200, '匿名应可只读仪表盘');
  const body = await res.json();
  const repos = (body && body.data && body.data.repos) || [];
  for (const r of repos) {
    assert.equal(r.lastCheckError, null, '匿名不得返回 lastCheckError');
    for (const k of Object.keys(r)) {
      assert.ok(!/token|secret|password|hash/i.test(k), `匿名响应不得含敏感字段: ${k}`);
    }
  }
});

await it('/api/repos 携带有效管理员令牌返回 200', async () => {
  // 管理员已在前序用例初始化；此处仅签发并保存新会话
  const { issueTokens } = await import('../server/lib/auth/jwt.js');
  const { saveSession } = await import('../server/lib/auth/admin.js');
  const { accessToken, jti } = await issueTokens('admin', NON_NODE_ENV);
  await saveSession(jti);
  const res = await reposGet({ request: req({ Authorization: `Bearer ${accessToken}` }), env: NON_NODE_ENV });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.code, 200);
  assert.ok(Array.isArray(data.data.repos));
});

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
