/**
 * 管理员登录
 *   POST /api/admin/login -> { username, password } 返回双 Token
 */

import { verifyAdmin } from '../../lib/auth/admin.js';
import { issueTokens } from '../../lib/auth/jwt.js';
import { saveSession } from '../../lib/auth/admin.js';
import { json } from '../../lib/auth/middleware.js';
import { kvGetJSON, kvUpdate, kvDelete } from '../../lib/utils/kv.js';

// 1.0.2：登录失败限流（KV 计数，跨请求生效；反代层再限流更彻底，两层可叠加）
const MAX_FAILS = 5;              // 连续失败阈值
const BASE_LOCK_MS = 60_000;      // 首次锁定时长
const MAX_LOCK_MS = 15 * 60_000;  // 锁定上限

function clientIp(request) {
  const xff = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return xff || request.headers.get('x-real-ip') || 'unknown';
}

function failKey(username, request) {
  return `loginfail:${String(username).toLowerCase()}:${clientIp(request)}`;
}

export async function onRequestPost(context) {
  try {
    const { request } = context;

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ code: 400, message: '请求体格式错误' }, 400);
    }

    const username = (body.username || '').toString().trim();
    const password = body.password || '';

    // 限流检查：锁定未到期直接拒绝（不暴露账号是否存在）
    const key = failKey(username, request);
    const rec = await kvGetJSON(key).catch(() => null);
    const now = Date.now();
    if (rec && rec.until && now < rec.until) {
      const waitSec = Math.ceil((rec.until - now) / 1000);
      return json({ code: 429, message: `尝试过于频繁，请 ${waitSec} 秒后再试` }, 429);
    }

    if (!(await verifyAdmin(username, password))) {
      // 失败计数 + 指数退避：第 5 次起锁定，之后每次翻倍，上限 15 分钟
      await kvUpdate(key, (cur) => {
        const fails = ((cur && cur.fails) || 0) + 1;
        const over = Math.max(0, fails - MAX_FAILS);
        const lockMs = over > 0 ? Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (over - 1)) : 0;
        return { fails, until: lockMs ? Date.now() + lockMs : 0 };
      }).catch(() => null);
      return json({ code: 401, message: '用户名或密码错误' }, 401);
    }

    // 登录成功：清除失败记录
    await kvDelete(key).catch(() => null);

    const { accessToken, refreshToken, jti } = await issueTokens(username, context.env);
    await saveSession(jti);

    return json({
      code: 200,
      message: '登录成功',
      data: { accessToken, refreshToken, username }
    });
  } catch (e) {
    // 未捕获异常统一返回 JSON 500，避免边缘网关返回私有码（如 545）掩盖真实错误
    console.error('[login] 处理失败:', e && e.message);
    return json({ code: 500, message: '服务器内部错误' }, 500);
  }
}
