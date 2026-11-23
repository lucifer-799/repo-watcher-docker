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

/**
 * 取客户端 IP（用于登录失败限流的分桶键）。
 *
 * 取值优先级（1.1.1 修正）：
 *   1. `x-real-ip` —— 由反向代理（NPM/Caddy/Nginx）**覆盖设置**，客户端自带同名头会被代理覆盖，
 *      因此比 XFF 更难伪造；
 *   2. `x-forwarded-for` 的**最右一跳** —— 由最近一级可信代理追加，而非客户端可控的最左值；
 *   3. 'unknown' 兜底（此时所有匿名请求共用同一桶，只会更严格、不会绕过）。
 *
 * 修正原因：旧实现取 XFF **最左值**，攻击者只要在请求里自带
 * `X-Forwarded-For: <随机IP>` 就能每次换一个桶，从而无限绕过失败锁定。
 *
 * 注意：最彻底的防线在反向代理层（丢弃/覆盖客户端自带的 XFF、并设置 x-real-ip）。
 * 本函数保证「即使代理透传了客户端 XFF，也不会用可伪造的最左值分桶」。
 */
function clientIp(request) {
  const realIp = (request.headers.get('x-real-ip') || '').trim();
  if (realIp) return realIp;
  const xff = (request.headers.get('x-forwarded-for') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // 最右一跳 = 最近可信代理追加的值
  if (xff.length) return xff[xff.length - 1];
  return 'unknown';
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
