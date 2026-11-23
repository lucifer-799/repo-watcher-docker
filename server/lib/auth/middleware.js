/**
 * 鉴权中间件辅助函数
 */

import { verifyAccessToken, verifyRefreshToken, extractBearer } from './jwt.js';
import { sessionExists } from './admin.js';
import { getGatewayPrincipal } from './gateway.js';

/**
 * 校验 access token，要求 type === 'access' 且 jti 会话存在
 *
 * 混合认证（自托管 Node 部署）：JWT 校验失败时，若统一网关标识当前请求来自
 * NAS 管理员（X-Trim-Isadmin=1），则视为已认证管理员。该头可信的前提是服务
 * 只监听 Unix Socket，详见 lib/auth/gateway.js 顶部说明。
 *
 * @param {Request} request
 * @param {Object} [env] 运行时环境（用于注入 JWT_SECRET 等环境变量）
 * @returns {Promise<{ok: boolean, status?: number, message?: string, payload?: Object, mode?: string}>}
 */
export async function requireAccess(request, env) {
  // env 显式传给校验函数（1.1.1 起不再写模块级共享状态）
  const token = extractBearer(request);
  if (token) {
    try {
      const payload = await verifyAccessToken(token, env);
      if (!(await sessionExists(payload.jti))) return { ok: false, status: 401, message: '会话已失效，请重新登录' };
      return { ok: true, payload, mode: 'password' };
    } catch (e) {
      // 落到下方网关分支再判断一次；若仍失败则返回令牌错误
    }
  }

  // 网关管理员分支：仅自托管 Node 运行时生效，其他运行时恒为 present=false
  const principal = getGatewayPrincipal(request, env);
  if (principal.isAdmin) {
    return {
      ok: true,
      mode: 'gateway',
      payload: {
        sub: principal.username || 'admin',
        type: 'access',
        // 网关会话 jti 不落库，故不带 jti，避免与本地会话逻辑耦合
      },
      principal,
    };
  }

  if (token) return { ok: false, status: 401, message: '令牌无效' };
  return { ok: false, status: 401, message: '缺少访问令牌' };
}

/**
 * 校验 refresh token，要求 type === 'refresh'
 */
export async function requireRefresh(request, env) {
  const token = extractBearer(request);
  if (!token) return { ok: false, status: 401, message: '缺少刷新令牌' };
  try {
    const payload = await verifyRefreshToken(token, env);
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, status: 401, message: e.message || '刷新令牌无效' };
  }
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
