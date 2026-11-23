/**
 * 单仓库手动检测接口（需鉴权）
 *   POST /api/admin/check
 *
 * 请求体：
 *   - platform: 平台（github / gitee / gitlab / cnb），必填
 *   - repo:     仓库名（owner/repo 或 owner/repo@branch 中的 owner/repo 部分），必填
 *   - branch:   分支（可选；缺省使用平台默认分支）
 *   - notify:   true 时检测后发送通知（可选，默认 true）
 *
 * 复用 performCheck 的 targetRepo 分支，仅针对该仓库发起检测。
 * 该端点由后台管理鉴权（requireAccess）保护，无需配置 CHECK_TOKEN。
 */

import { requireAccess } from '../../lib/auth/middleware.js';
import { getConfig } from '../../lib/config.js';
import { performCheck } from '../check.js';
import { json } from '../../lib/auth/middleware.js';

const SUPPORTED = ['github', 'gitee', 'gitlab', 'gitcode', 'cnb'];

export async function onRequestPost(context) {
  const { request } = context;

  const auth = await requireAccess(request, context.env);
  if (!auth.ok) return json({ code: auth.status, message: auth.message }, auth.status);

  let body;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    return json({ code: 400, message: '请求体格式错误' }, 400);
  }

  const platform = String(body.platform || '').toLowerCase();
  if (!SUPPORTED.includes(platform)) {
    return json({ code: 400, message: `platform 不合法，应为 ${SUPPORTED.join(' / ')}` }, 400);
  }

  const repo = String(body.repo || '').trim();
  if (!repo || !/^[\w.\-]+\/[\w.\-]+$/.test(repo)) {
    return json({ code: 400, message: 'repo 格式错误，正确格式：owner/repo' }, 400);
  }

  const branch = String(body.branch || '').trim();
  const targetRepo = branch ? `${repo}@${branch}` : repo;
  const enableNotify = body.notify === true || body.notify === 'true';

  let config;
  try {
    config = await getConfig(context.env);
  } catch (err) {
    return json({ code: 500, message: '读取配置失败：' + err.message }, 500);
  }

  try {
    const result = await performCheck(config, { targetRepo, platform, enableNotify });
    if (result.error) {
      return json({ code: 400, message: result.error }, 400);
    }
    return json({ code: 200, message: '检测完成', data: result.results });
  } catch (err) {
    return json({ code: 500, message: '检测失败：' + err.message }, 500);
  }
}
