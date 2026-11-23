/**
 * 自托管网关模式 统一网关身份解析
 *
 * 统一网关在转发前校验 NAS 会话，并注入 X-Trim-Userid / X-Trim-Isadmin / X-Trim-Username。
 *
 * ⚠️ 可信性前提（关键）：这些请求头只有在**服务仅监听 Unix Socket、网关是唯一入口**
 * 时才可信。一旦服务额外暴露 TCP 端口，攻击者可自行构造这些头直接提权为管理员。
 * 该不变量由 server/index.js 保证（只走 server.listen(socketPath)）。
 *
 * 本文件不新增任何 import（便于单元测试与跨运行时复用）。
 */

/**
 * 统一真值判定（'1' / 'true' / true / 1 均视为真）。
 *
 * 该函数是「是否信任网关身份头」的唯一判定口径，供两处共用：
 *   1. 本文件的 getGatewayPrincipal（运行时逐请求判定）
 *   2. server/index.js 的启动检查（TCP 暴露 + 信任网关 = 拒绝启动）
 * 两处口径必须一致，否则会出现「启动检查放行、运行时却信任」的缺口。
 *
 * @param {*} v
 * @returns {boolean}
 */
export function isTruthy(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

/**
 * 判断当前运行环境是否为自托管 Node 常驻进程。
 * 仅当 RUNTIME=node 时才读取网关头，避免其他运行时误信客户端伪造的请求头。
 *
 * @param {Object} [env]
 * @returns {boolean}
 */
export function isNodeRuntime(env) {
  const e = env || globalThis;
  return (e && (e.RUNTIME === 'node' || e.runtime === 'node')) ||
    globalThis.RUNTIME === 'node';
}

/**
 * 从统一网关可信头解析当前主体。
 * 仅在自托管 Node 环境下有意义；其他运行时恒返回「无主体」。
 *
 * @param {Request} request
 * @param {Object} [env]
 * @returns {{ userId: string|null, username: string|null, isAdmin: boolean, present: boolean }}
 */
export function getGatewayPrincipal(request, env) {
  if (!isNodeRuntime(env)) {
    return { userId: null, username: null, isAdmin: false, present: false };
  }

  // ⚠️ 安全门槛（1.0.0 docker 版新增）：网关头仅在显式开启时才可信。
  // 默认关闭（fail-closed）：docker/TCP 部署下任何人都能伪造 X-Trim-Isadmin=1，
  // 如果不加这道门，暴露 TCP 就等于把管理员权限公开。Socket（仅 Unix Socket）部署
  // 需在 cmd/main 里显式设置 TRUST_GATEWAY_HEADERS=1 才恢复网关免密。
  const e = env || globalThis;
  // 与启动检查共用同一判定口径，避免两处语义漂移
  const trust = isTruthy(e && e.TRUST_GATEWAY_HEADERS) || isTruthy(globalThis.TRUST_GATEWAY_HEADERS);
  if (!trust) {
    return { userId: null, username: null, isAdmin: false, present: false };
  }

  const headers = request && request.headers;
  if (!headers || typeof headers.get !== 'function') {
    return { userId: null, username: null, isAdmin: false, present: false };
  }

  const userId = headers.get('X-Trim-Userid');
  const username = headers.get('X-Trim-Username');
  const isAdmin = headers.get('X-Trim-Isadmin') === '1';

  // 三个头全缺失说明请求并非来自网关（如服务端内部调用），此时不可假定任何身份
  const present = !!(userId || username || headers.get('X-Trim-Isadmin'));

  return {
    userId: userId || null,
    username: username || null,
    isAdmin,
    present,
  };
}
