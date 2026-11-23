/**
 * 管理员登录
 *   POST /api/admin/login -> { username, password } 返回双 Token
 */

import { verifyAdmin } from '../../lib/auth/admin.js';
import { issueTokens } from '../../lib/auth/jwt.js';
import { saveSession } from '../../lib/auth/admin.js';
import { json } from '../../lib/auth/middleware.js';
import { kvGetJSON, kvUpdate, kvDelete } from '../../lib/utils/kv.js';
import { isTruthy } from '../../lib/auth/gateway.js';

// 1.0.2：登录失败限流（KV 计数，跨请求生效；反代层再限流更彻底，两层可叠加）
const MAX_FAILS = 5;              // 连续失败阈值
const FAIL_TTL_MS = 7 * 24 * 3600_000; // 失败记录最长保留 7 天（防 key 无限累积）
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
function clientIp(request, env) {
  // 是否信任代理头：默认 false（安全）。仅在明确部署于可信反向代理之后时设为 true。
  //   - false：使用 TCP 连接的真实对端地址（挂载在 request.__socketRemoteAddress，
  //     不是 HTTP 头，客户端无法伪造）→ 伪造 XFF/x-real-ip 完全无效；
  //   - true ：依次采用 x-real-ip（反代覆盖设置）> XFF 最右一跳 > unknown。
  // 为什么默认不信任：x-real-ip 与 XFF 都是 HTTP 头，客户端可自带；
  // 只有反代会覆盖/追加它们时才可信（NPM/Caddy/Nginx 的默认行为）。
  const trustProxy = isTruthy(env && env.TRUST_PROXY_HEADERS) || isTruthy(globalThis.TRUST_PROXY_HEADERS);

  if (!trustProxy) {
    const socketIp = request && request.__socketRemoteAddress;
    return socketIp || 'unknown';
  }

  const realIp = (request.headers.get('x-real-ip') || '').trim();
  if (realIp) return realIp;
  const xff = (request.headers.get('x-forwarded-for') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (xff.length) return xff[xff.length - 1];
  return 'unknown';
}

function failKey(username, request, env) {
  return `loginfail:${String(username).toLowerCase()}:${clientIp(request, env)}`;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ code: 400, message: '请求体格式错误' }, 400);
    }

    const username = (body.username || '').toString().trim();
    const password = body.password || '';

    // 限流检查：锁定未到期直接拒绝（不暴露账号是否存在）
    const key = failKey(username, request, env);
    const now = Date.now();
    let rec = await kvGetJSON(key).catch(() => null);
    // 过期记录视为不存在（并把垃圾 key 清掉，避免长期堆积）
    if (rec && rec.exp && rec.exp < now) {
      await kvDelete(key).catch(() => null);
      rec = null;
    }
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
        const t = Date.now();
        return { fails, until: lockMs ? t + lockMs : 0, exp: t + FAIL_TTL_MS };
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
