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

  // refresh token 一次性轮换（1.1.1 修正顺序，避免「先消费后签发、中途失败丢会话」）：
  //   1) 先签发新的一对令牌并**保存新会话**（此时旧会话仍然有效，失败可回退）；
  //   2) 再用 CAS 占用标记「原子地」认领旧令牌，保证并发重放只有一个成功；
  //      认领失败说明已被别的请求用掉 → 撤销刚建的新会话，返回 401，旧会话不受影响；
  //   3) 最后才吊销旧会话。
  // 标记前缀 session: 便于「全量登出」时一并清理。
  const oldJti = auth.payload.jti;

  // 1) 建新会话
  const { accessToken, refreshToken, jti } = await issueTokens(auth.payload.sub, context.env);
  await saveSession(jti);

  // 2) 原子认领旧令牌（CAS）；失败则回滚刚建的新会话，保证「失败不丢任何会话」
  let claimed = false;
  try {
    claimed = await kvPutIfAbsent('session:rot:' + oldJti, new Date().toISOString());
  } catch (e) {
    // 认领过程本身异常：回滚新会话后按服务器错误返回，旧会话仍可用
    await deleteSession(jti).catch(() => null);
    throw e;
  }
  if (!claimed) {
    await deleteSession(jti).catch(() => null);
    return json({ code: 401, message: '刷新令牌已被使用，请重新登录' }, 401);
  }

  // 3) 吊销旧会话
  await deleteSession(oldJti);

  return json({ code: 200, message: '刷新成功', data: { accessToken, refreshToken } });
}
