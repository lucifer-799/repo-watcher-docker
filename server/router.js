/**
 * 路由表与方法分派
 *
 * 镜像 edge-functions/api 的文件系统路由，把 HTTP 请求分派给现有 handler。
 * handler 全部是 onRequest{Method}(context) 形式，与 EdgeOne 约定一致，
 * 因此这里只负责：路径归一化 -> 查表 -> 构造 context -> 调用。
 */

const ROUTES = {
  '/api/repos': () => import('../edge-functions/api/repos.js'),
  '/api/check': () => import('../edge-functions/api/check.js'),
  '/api/admin/init': () => import('../edge-functions/api/admin/init.js'),
  '/api/admin/login': () => import('../edge-functions/api/admin/login.js'),
  '/api/admin/refresh': () => import('../edge-functions/api/admin/refresh.js'),
  '/api/admin/logout': () => import('../edge-functions/api/admin/logout.js'),
  '/api/admin/password': () => import('../edge-functions/api/admin/password.js'),
  '/api/admin/config': () => import('../edge-functions/api/admin/config.js'),
  '/api/admin/session': () => import('../edge-functions/api/admin/session.js'),
  '/api/admin/test-notify': () => import('../edge-functions/api/admin/test-notify.js'),
  '/api/admin/check': () => import('../edge-functions/api/admin/check.js'),
};

// 统一网关前缀。当前置网关转发时可能附带前缀，服务端自行归一化：
// 带前缀与不带前缀的路径都接受，不依赖网关行为。
const GATEWAY_PREFIX = '/app/repowatcher';

/**
 * 归一化请求路径：剥离网关前缀，去掉尾部斜杠（根路径除外）。
 * @param {string} pathname
 * @returns {string}
 */
export function normalizePath(pathname) {
  let p = pathname || '/';
  if (p === GATEWAY_PREFIX) return '/';
  if (p.startsWith(GATEWAY_PREFIX + '/')) p = p.slice(GATEWAY_PREFIX.length);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

/**
 * 分派请求到对应 handler。
 *
 * @param {Request} request 标准 Request 对象
 * @param {Object} env 环境变量（供 context.env 使用）
 * @returns {Promise<Response>}
 */
export async function dispatch(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  // 非 API 路径交由静态中间件处理
  if (!path.startsWith('/api/')) return null;

  const loader = ROUTES[path];
  if (!loader) {
    return json({ code: 404, message: '接口不存在' }, 404);
  }

  const mod = await loader();
  const method = request.method.toUpperCase();

  // 按 onRequest{Method} -> onRequest 顺序查找，与 EdgeOne 约定一致
  const named = `onRequest${method.charAt(0)}${method.slice(1).toLowerCase()}`;
  const handler = mod[named] || mod.onRequest;

  if (typeof handler !== 'function') {
    return json({ code: 405, message: `方法不被允许: ${method}` }, 405);
  }

  const context = {
    request,
    env,
    params: {},
  };

  try {
    const res = await handler(context);
    if (res instanceof Response) return res;
    // handler 未返回 Response 时兜底，避免请求悬挂
    return json({ code: 500, message: '接口未返回响应' }, 500);
  } catch (err) {
    // 业务异常不得让进程退出；记录日志后统一返回 JSON 500
    console.error(`[router] ${method} ${path} 处理失败:`, err);
    // 对外只给通用错误：原始 message 可能含路径/SQL/内部细节，仅写入日志
    return json({ code: 500, message: '服务器内部错误' }, 500);
  }
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
