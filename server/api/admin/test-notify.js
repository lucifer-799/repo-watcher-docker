/**
 * 通知测试接口（需鉴权，替代原公开 /api/test-notify）
 *   POST /api/admin/test-notify
 */

import { requireAccess } from '../../lib/auth/middleware.js';
import { getConfig } from '../../lib/config.js';
import { sendMagicPushNotification, sendCustomNotification } from '../../lib/services/notify.js';
import { json } from '../../lib/auth/middleware.js';

export async function onRequestPost(context) {
  const { request } = context;
  const auth = await requireAccess(request, context.env);
  if (!auth.ok) return json({ code: auth.status, message: auth.message }, auth.status);

  const config = await getConfig(context.env);
  const results = [];

  const mockResult = {
    repo: 'test/repo@main',
    hasUpdate: true,
    latestSha: 'abc1234567890',
    latestDate: new Date().toISOString(),
    previousSha: 'def0987654321',
    isFirstCheck: false,
    url: 'https://example.com/test/repo',
    platform: 'github'
  };

  const tasks = [];

  if (config.magicpush?.enabled === true && config.magicpush?.url && config.magicpush?.token) {
    tasks.push(
      sendMagicPushNotification(mockResult, config).then(r => ({ channel: 'magicpush', status: r.ok ? 'success' : 'failed', ...(r.error ? { reason: r.error } : {}) }))
    );
  } else {
    results.push({ channel: 'magicpush', status: 'skipped', reason: '未启用或未配置 magicpush.url / magicpush.token' });
  }

  if (config.custom?.enabled === true && config.custom?.url) {
    tasks.push(
      sendCustomNotification(mockResult, config).then(r => ({ channel: 'custom', status: r.ok ? 'success' : 'failed', ...(r.error ? { reason: r.error } : {}) }))
    );
  } else {
    results.push({ channel: 'custom', status: 'skipped', reason: '未启用或未配置自定义通知 URL' });
  }

  const tested = await Promise.all(tasks);
  results.push(...tested);

  return json({ code: 200, message: '通知测试完成', data: results });
}
