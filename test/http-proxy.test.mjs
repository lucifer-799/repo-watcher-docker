/**
 * HTTP 代理客户端测试
 *
 * 验证 server/http-client.js 的 nodeFetchWithProxy：
 *   1. 无代理时直连目标 HTTP 服务（走全局 fetch，语义不变）；
 *   2. 有代理时经 HTTP 正向代理转发到目标；
 *   3. 代理地址含账号密码时，Proxy-Authorization 头被正确发送。
 *
 * 说明：CONNECT（HTTPS 目标经代理）路径与 HTTP 转发路径结构一致，且已在
 * fnOS 启动时注入；本测试覆盖无代理与 HTTP 转发两条高频路径，避免回归。
 *
 * 运行：node scripts/http-proxy.test.mjs
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { Buffer } from 'node:buffer';

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

// 目标 HTTP 服务
const target = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, path: req.url }));
});
await new Promise((r) => target.listen(0, r));
const targetPort = target.address().port;

// 最小 HTTP 正向代理：转发绝对 URI 请求到目标
function startProxy() {
  const p = http.createServer((req, res) => {
    const u = new URL(req.url);
    const fwd = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }
    );
    req.pipe(fwd);
  });
  return new Promise((resolve) => p.listen(0, () => resolve(p)));
}

const { createNodeFetchClient } = await import('../server/http-client.js');
const client = createNodeFetchClient();

console.log('HTTP 代理客户端测试\n');

await it('无代理：直连目标 HTTP 服务', async () => {
  const res = await client(`http://127.0.0.1:${targetPort}/hello`, { method: 'GET' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
});

await it('有代理：经 HTTP 代理转发到目标', async () => {
  const proxy = await startProxy();
  const proxyPort = proxy.address().port;
  try {
    const res = await client(`http://127.0.0.1:${targetPort}/via-proxy`, {}, `http://127.0.0.1:${proxyPort}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.path, '/via-proxy');
  } finally {
    proxy.close();
  }
});

await it('有代理且带鉴权：Proxy-Authorization 被发送', async () => {
  let seenAuth = null;
  const authProxy = http.createServer((req, res) => {
    seenAuth = req.headers['proxy-authorization'] || null;
    const u = new URL(req.url);
    const fwd = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }
    );
    req.pipe(fwd);
  });
  await new Promise((r) => authProxy.listen(0, r));
  const ap = authProxy.address().port;
  try {
    const res = await client(`http://127.0.0.1:${targetPort}/auth`, {}, `http://user:pass@127.0.0.1:${ap}`);
    assert.equal(res.status, 200);
    assert.equal(seenAuth, 'Basic ' + Buffer.from('user:pass').toString('base64'));
  } finally {
    authProxy.close();
  }
});

target.close();

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
