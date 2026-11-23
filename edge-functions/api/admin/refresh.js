/**
 * 刷新 access token
 *   POST /api/admin/refresh -> 携带 refresh token 返回新 access token
 */

import { requireRefresh, json } from '../../lib/auth/middleware.js';
import { sessionExists, saveSession, deleteSession } from '../../lib/auth/admin.js';
import { issueTokens } from '../../lib/auth/jwt.js';
import { kvPutIfAbsent } from '../../lib/utils/kv.js';

export async function onRequestPost(context) {
  const { request } = context;

  const auth = await requireRefresh(request, context.env);
  if (!auth.ok) return json({ code: auth.status, message: auth.message }, auth.status);

  // refresh 会话需有效
  if (!(await sessionExists(auth.payload.jti))) {
    return json({ code: 401, message: '会话已失效，请重新登录' }, 401);
  }

  // 1.0.2：refresh token 一次性（轮换）。用 CAS 占用标记保证同一旧令牌只能换一次，
  // 并发重放只有一个成功，其余 401；标记前缀 session: 便于「全量登出」时一并清理。
  const oldJti = auth.payload.jti;
  const claimed = await kvPutIfAbsent('session:rot:' + oldJti, new Date().toISOString());
  if (!claimed) {
    return json({ code: 401, message: '刷新令牌已被使用，请重新登录' }, 401);
  }

  // 签发新的一对令牌并接管会话，随后吊销旧会话
  const { accessToken, refreshToken, jti } = await issueTokens(auth.payload.sub, context.env);
  await saveSession(jti);
  await deleteSession(oldJti);

  return json({ code: 200, message: '刷新成功', data: { accessToken, refreshToken } });
}
