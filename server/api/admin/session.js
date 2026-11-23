/**
 * GET /api/admin/session
 *
 * 返回当前认证模式与主体，供前端决定渲染控制台还是登录页。
 *
 * 两种模式：
 *   - gateway：由可信前置网关注入的管理员身份（X-Trim-Isadmin=1），无需本地密码。
 *   - password：回落到账号密码 + JWT 双 Token 流程。
 *
 * 该接口本身**不做鉴权**（前端需在未登录状态下也能调用以决定渲染分支），
 * 因此只暴露「是否已认证」与用户名，不返回任何敏感信息。
 */

import { json, requireAccess } from '../../lib/auth/middleware.js';
import { getGatewayPrincipal } from '../../lib/auth/gateway.js';
import { isInitialized } from '../../lib/auth/admin.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const principal = getGatewayPrincipal(request, env);

  // 网关管理员：直接视为已认证
  if (principal.isAdmin) {
    return json({
      code: 200,
      data: {
        mode: 'gateway',
        authenticated: true,
        username: principal.username || 'admin',
        userId: principal.userId,
        initialized: true,
        // 网关模式下无本地会话，无需登出/改密入口
        canChangePassword: false,
        canLogout: false,
      },
    });
  }

  // 非网关管理员：若持有有效本地 token 则已认证
  const auth = await requireAccess(request, env);

  let initialized = false;
  try {
    initialized = await isInitialized();
  } catch {
    initialized = false;
  }

  return json({
    code: 200,
    data: {
      mode: 'password',
      authenticated: auth.ok,
      username: auth.ok ? (principal.username || auth.payload?.sub || '') : '',
      initialized,
      canChangePassword: true,
      canLogout: true,
    },
  });
}
