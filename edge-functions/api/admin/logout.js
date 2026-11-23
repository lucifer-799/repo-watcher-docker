/**
 * 登出 -> 吊销 refresh token 会话
 *   POST /api/admin/logout
 */

import { requireAccess } from '../../lib/auth/middleware.js';
import { deleteSession } from '../../lib/auth/admin.js';
import { json } from '../../lib/auth/middleware.js';

export async function onRequestPost(context) {
  const { request } = context;

  const auth = await requireAccess(request, context.env);
  if (!auth.ok) return json({ code: auth.status, message: auth.message }, auth.status);

  // 网关模式无本地会话，登出由 NAS 侧处理；此处仅清除前端状态即可
  if (auth.mode === 'gateway' || !auth.payload?.jti) {
    return json({ code: 200, message: '当前为网关登录，请在前置网关中退出', mode: 'gateway' });
  }

  await deleteSession(auth.payload.jti);
  return json({ code: 200, message: '已登出', mode: 'password' });
}
