/**
 * 配置读写接口（需鉴权）
 *   GET  /api/admin/config -> 脱敏配置
 *   PUT  /api/admin/config -> 合并并保存配置（敏感字段加密）
 */

import { requireAccess } from '../../lib/auth/middleware.js';
import { getMaskedConfig, getSecretStatus, saveConfig, getCapabilities } from '../../lib/config.js';
import { json } from '../../lib/auth/middleware.js';

export async function onRequestGet(context) {
  const { request } = context;
  const auth = await requireAccess(request, context.env);
  if (!auth.ok) return json({ code: auth.status, message: auth.message }, auth.status);

  const config = await getMaskedConfig(context.env);
  const secrets = await getSecretStatus(context.env);
  // 能力位：前端据此决定是否渲染仅常驻进程可用的功能（如内置定时检测）
  const capabilities = getCapabilities(context.env);
  return json({ code: 200, message: '获取成功', data: config, secrets, capabilities });
}

export async function onRequestPut(context) {
  const { request } = context;
  const auth = await requireAccess(request, context.env);
  if (!auth.ok) return json({ code: auth.status, message: auth.message }, auth.status);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ code: 400, message: '请求体格式错误' }, 400);
  }

  await saveConfig(body, context.env);
  const config = await getMaskedConfig(context.env);
  const secrets = await getSecretStatus(context.env);
  const capabilities = getCapabilities(context.env);
  return json({ code: 200, message: '保存成功', data: config, secrets, capabilities });
}
