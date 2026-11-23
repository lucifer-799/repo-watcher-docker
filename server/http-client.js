/**
 * 自托管 Node 运行时的 HTTP 代理客户端
 *
 * 基于 Node 内置 node:http / node:https / node:tls 实现 HTTP/HTTPS 代理转发，
 * 不引入任何第三方依赖：
 *   - HTTPS 目标：向（HTTP 或 HTTPS）代理发起 CONNECT 隧道，再于隧道上发起 TLS 请求；
 *   - HTTP  目标：以绝对 URL 作为请求路径，由代理转发。
 * 自动跟随最多 5 次重定向（对齐 fetch 默认 redirect=follow）。
 * 返回的始终是标准 Response 对象，业务层无需感知差异。
 *
 * 由 server/index.js 在启动时通过 setFetchClient 注入，仅在 RUNTIME==='node' 生效。
 *
 * 典型用途：国内网络访问 GitHub 体验不佳时，可为 GitHub 单独配置一个 HTTP 代理，
 * 其余平台仍可直连（每个平台的代理在管理后台独立配置）。
 */

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT = 15000;

function toHeaders(initHeaders) {
  const h = new Headers(initHeaders || {});
  const out = {};
  h.forEach((v, k) => { out[k] = v; });
  return out;
}

function buildResponse(nodeRes) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    nodeRes.on('data', (c) => chunks.push(c));
    nodeRes.on('end', () => {
      const buf = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [k, v] of Object.entries(nodeRes.headers)) {
        if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
        else headers.set(k, v);
      }
      resolve(new Response(buf, {
        status: nodeRes.statusCode,
        statusText: nodeRes.statusMessage,
        headers,
      }));
    });
    nodeRes.on('error', reject);
  });
}

function proxyAuthHeader(proxyUrl) {
  if (proxyUrl.username && proxyUrl.password) {
    const cred = `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`;
    return 'Basic ' + Buffer.from(cred).toString('base64');
  }
  return null;
}

/**
 * 发起到目标的单次请求（不处理重定向），通过代理。
 * @returns {Promise<Response>}
 */
async function requestOnce(targetUrl, method, headers, body, proxy) {
  const target = new URL(targetUrl);
  const isHttpsTarget = target.protocol === 'https:';
  const proxyUrl = new URL(proxy);
  const proxyHost = proxyUrl.hostname;
  const proxyPort = proxyUrl.port || (proxyUrl.protocol === 'https:' ? 443 : 80);
  const isHttpsProxy = proxyUrl.protocol === 'https:';

  // 统一小写键，避免出 { Host: ... } 这类大小写变体绕过下面的删除
  const reqHeaders = {};
  for (const [k, v] of Object.entries(headers || {})) reqHeaders[k.toLowerCase()] = v;

  // 不向代理请求泄漏 Host / Content-Length（由底层按目标自行决定）
  delete reqHeaders.host;
  delete reqHeaders['content-length'];

  const auth = proxyAuthHeader(proxyUrl);
  // 代理认证头只在「HTTP 目标（经代理转发）」时附上；
  // HTTPS 走 CONNECT 隧道时该头属于到代理的一跳，绝不能带进隧道内的目标请求（会泄漏给目标站）。
  if (auth && !isHttpsTarget) reqHeaders['proxy-authorization'] = auth;

  return new Promise((resolve, reject) => {
    // HTTP 目标：直接请求代理，路径用绝对 URI，由代理转发到目标（无需 CONNECT）
    if (!isHttpsTarget) {
      const req = http.request({
        host: proxyHost,
        port: proxyPort,
        method,
        path: target.href,
        headers: reqHeaders,
        timeout: REQUEST_TIMEOUT,
      }, resolve);
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('请求超时')));
      if (body != null) req.write(body);
      req.end();
      return;
    }

    // HTTPS 目标：先向代理发起 CONNECT 隧道，再于隧道上做 TLS 并发起请求
    const onConnectedSocket = (socket) => {
      const tlsSocket = tls.connect({ socket, servername: target.hostname }, () => {
        // 隧道内的请求面向目标站：必须带正确的 Host（此前 createConnection 模式下未显式设置，
        // 可能导致 Host 缺失或残留代理侧值），且绝不能再带 proxy-authorization。
        const tunnelHeaders = { ...reqHeaders, host: target.host };
        delete tunnelHeaders['proxy-authorization'];
        const req = https.request({
          method,
          path: target.pathname + target.search,
          headers: tunnelHeaders,
          createConnection: () => tlsSocket,
          agent: false,
          timeout: REQUEST_TIMEOUT,
        }, resolve);
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('请求超时')));
        if (body != null) req.write(body);
        req.end();
      });
      tlsSocket.on('error', reject);
    };

    const connectReq = (isHttpsProxy ? https : http).request({
      host: proxyHost,
      port: proxyPort,
      method: 'CONNECT',
      path: `${target.hostname}:${target.port || 443}`,
      headers: auth ? { 'proxy-authorization': auth } : undefined,
      timeout: REQUEST_TIMEOUT,
    });
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        reject(new Error(`代理 CONNECT 失败: ${res.statusCode} ${res.statusMessage || ''}`));
        return;
      }
      onConnectedSocket(socket);
    });
    connectReq.on('error', reject);
    connectReq.on('timeout', () => connectReq.destroy(new Error('代理连接超时')));
    connectReq.end();
  }).then(buildResponse);
}

/**
 * 带代理的统一请求函数（与 fetch 签名兼容，附加 proxyUrl 参数）。
 * 无代理时直接走全局 fetch，完整保留 fetch 语义（重定向、流式等）。
 * @param {string} url
 * @param {object} [init]
 * @param {string} [proxyUrl]
 * @returns {Promise<Response>}
 */
export async function nodeFetchWithProxy(url, init = {}, proxyUrl = '') {
  if (!proxyUrl) {
    return fetch(url, init);
  }

  let currentUrl = url;
  let currentMethod = (init.method || 'GET').toUpperCase();
  let currentHeaders = toHeaders(init.headers);
  let currentBody = init.body != null
    ? (typeof init.body === 'string' || Buffer.isBuffer(init.body) ? init.body : String(init.body))
    : undefined;

  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    const res = await requestOnce(currentUrl, currentMethod, currentHeaders, currentBody, proxyUrl);
    if (res.status >= 300 && res.status < 400 && res.headers.has('location') && i < MAX_REDIRECTS) {
      const location = res.headers.get('location');
      currentUrl = new URL(location, currentUrl).href;
      // 301/302/303 改为 GET 并丢弃 body；307/308 保留方法与原 body
      if ([301, 302, 303].includes(res.status)) {
        currentMethod = 'GET';
        currentBody = undefined;
        delete currentHeaders['content-length'];
      }
      continue;
    }
    return res;
  }
  throw new Error('代理请求重定向次数过多');
}

/** 返回可注入 setFetchClient 的客户端函数。 */
export function createNodeFetchClient() {
  return (url, init, proxyUrl) => nodeFetchWithProxy(url, init, proxyUrl || '');
}
