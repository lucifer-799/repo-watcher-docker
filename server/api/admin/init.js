/**
 * 管理员初始化接口
 *   GET  /api/admin/init  -> 查询是否已初始化 { initialized: bool }
 *   POST /api/admin/init  -> 首次设置管理员账号（幂等，已初始化返回 409）
 */

import { isInitialized, initAdminIfAbsent } from '../../lib/auth/admin.js';
import { json } from '../../lib/auth/middleware.js';
import { getGatewayPrincipal } from '../../lib/auth/gateway.js';

export async function onRequestGet(context) {
  // 网关管理员无需本地账号，恒视为已初始化。
  // 否则前端路由守卫会把 NAS 管理员挡在初始化向导页，导致后台不可达。
  const principal = getGatewayPrincipal(context?.request, context?.env);
  if (principal.isAdmin) {
    return json({ code: 200, data: { initialized: true, mode: 'gateway' } });
  }

  const initialized = await isInitialized();
  return json({ code: 200, data: { initialized, mode: 'password' } });
}

export async function onRequestPost(context) {
  const { request } = context;

  // 网关模式下账号由 NAS 管理，不接受本地初始化
  const principal = getGatewayPrincipal(request, context.env);
  if (principal.isAdmin) {
    return json({ code: 409, message: '当前为网关登录模式，无需设置本地管理员' }, 409);
  }

  if (await isInitialized()) {
    return json({ code: 409, message: '管理员已初始化' }, 409);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ code: 400, message: '请求体格式错误' }, 400);
  }

  const username = (body.username || 'admin').toString().trim();
  const password = body.password || '';
  if (!username || password.length < 6) {
    return json({ code: 400, message: '用户名不能为空，密码至少 6 位' }, 400);
  }

  // 原子创建：并发下只有一个请求能成功，其余 409，避免管理员凭据被静默覆盖（TOCTOU）
  const created = await initAdminIfAbsent(username, password);
  if (!created) {
    return json({ code: 409, message: '管理员已初始化' }, 409);
  }
  return json({ code: 200, message: '初始化成功', data: { username } });
}
