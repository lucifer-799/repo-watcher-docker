/**
 * 自托管 Node 服务端入口（Docker 版）
 *
 * 监听方式（双模式，1.0.0 docker 版新增 TCP 支持）：
 *   1) Unix Socket（可选，未设置 PORT 时）：listen(SOCKET_PATH)，仅本机/网关可达。
 *   2) TCP（docker / 反代部署）：设置 PORT 环境变量后 listen(PORT, HOST)。
 *
 * ⚠️ 安全不变量（必读）：网关注入的 X-Trim-Userid / X-Trim-Isadmin / X-Trim-Username
 * 之所以可信，唯一前提是**只有网关能连到本服务**。一旦监听 TCP，任何人都能自行构造
 * 这些请求头直接提权为管理员。因此：
 *   - 走 TCP 时必须保持 TRUST_GATEWAY_HEADERS 关闭（默认关闭，见 lib/auth/gateway.js）；
 *   - 仅在 Socket 模式且确由可信网关前置时，才显式设 TRUST_GATEWAY_HEADERS=1（TCP 模式会拒绝启动）。
 * 两者不可兼得：TCP + 信任网关头 = 提权漏洞。
 *
 * 零第三方依赖：仅使用 Node 内置模块（node:http / node:fs / node:path / node:sqlite）。
 */

import http from 'node:http';
import { existsSync, statSync, createReadStream, rmSync, readFileSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSqliteDriver } from './storage/sqlite.js';
import { dispatch, normalizePath } from './router.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { isTruthy } from '../edge-functions/lib/auth/gateway.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ---- 配置 ----

// 静态资源目录（构建期由 dist/ 拷入）。相对本文件定位，兼容开发与安装两种布局。
const WWW_DIR = process.env.WWW_DIR || join(__dirname, '..', 'www');

// Unix Socket 路径（未设置 PORT 时使用）。
const SOCKET_PATH = process.env.SOCKET_PATH || join(__dirname, '..', 'app.sock');

// SQLite 落盘位置。默认 ./data/repo-watcher.db，容器内通常为 /app/data。
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'repo-watcher.db');

// TCP 监听端口（Docker / 反代部署，推荐）。为空则回退 Unix Socket 模式。
const PORT = (process.env.PORT || '').trim();
// TCP 监听地址。容器内需 0.0.0.0 才能被外部/反代访问。
const HOST = (process.env.HOST || '0.0.0.0').trim();

// 单请求体上限。所有接口均为 JSON 小载荷。
const MAX_BODY_BYTES = 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ---- 存储驱动注入 ----

// 必须在导入任何业务模块之前完成注册：业务模块在模块求值期不会读存储，
// 但 kv.js 的 activeDriver 是模块级状态，注册后所有后续导入共享同一实例。
const { setStorageDriver } = await import('../edge-functions/lib/utils/kv.js');
const driver = createSqliteDriver(DB_PATH);
setStorageDriver(driver);

// 注入 Node 运行时专用 HTTP 客户端（支持 HTTP/HTTPS 代理）。
// 仅对配置了代理的平台生效；EdgeOne 边缘运行时不会走到这里，默认实现会直连。
const { setFetchClient } = await import('../edge-functions/lib/utils/http.js');
const { createNodeFetchClient } = await import('./http-client.js');
setFetchClient(createNodeFetchClient());

// ---- 环境变量 ----

/**
 * 读取运行时配置目录下的 app.env（含 CONFIG_ENC_KEY / JWT_SECRET，权限 600）。
 * 只接受 KEY=VALUE 行，忽略注释与空行；不覆盖已有的 process.env 值。
 *
 * 放在服务端而非 shell 里 source，避免引号/空格导致的解析问题，
 * 也让服务在任意启动方式下都能拿到密钥。
 *
 * @param {string} etcDir
 * @returns {Object}
 */
function loadAppEnv(etcDir) {
  const file = join(etcDir, 'app.env');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // 去掉成对引号
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

const ETC_DIR = process.env.TRIM_PKGETC || join(__dirname, '..', 'etc');
const fileEnv = loadAppEnv(ETC_DIR);

// 业务代码通过 context.env 读取配置（initEnv(env) + globalThis 兜底）。
// 优先级：process.env（可被运维覆盖）> app.env（安装期生成的密钥）
const env = Object.freeze({
  ...fileEnv,
  ...process.env,
  // 标记常驻进程运行时，供 getCapabilities() 判定能力位
  RUNTIME: 'node',
});

// 密钥缺失时快速失败并给出可操作提示，避免运行中才报「解密失败」
for (const key of ['CONFIG_ENC_KEY', 'JWT_SECRET']) {
  if (!env[key]) {
    console.error(
      `[server] 缺少 ${key}。请确认已执行 install_callback 生成 ${join(ETC_DIR, 'app.env')}`
    );
    process.exit(1);
  }
}

// ---- 请求转换 ----

/**
 * 把 Node 的 IncomingMessage 转成标准 Request。
 * 先 buffer body 再构造，避免 duplex: 'half' 流式构造的兼容性问题。
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Request>}
 */
async function toRequest(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('请求体过大');
    }
    chunks.push(chunk);
  }
  const body = chunks.length ? Buffer.concat(chunks) : null;

  // 网关可能不带 Host，用占位域名保证 URL 可解析
  const host = req.headers.host || 'localhost';
  const url = `http://${host}${req.originalUrl || req.url}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item);
    } else {
      headers.set(k, v);
    }
  }

  const method = req.method || 'GET';
  const hasBody = !['GET', 'HEAD'].includes(method);

  return new Request(url, {
    method,
    headers,
    body: hasBody && body ? body : undefined,
  });
}

/**
 * 把标准 Response 写回 Node 的 ServerResponse。
 * @param {Response} res
 * @param {import('node:http').ServerResponse} raw
 */
async function writeResponse(res, raw) {
  // 多值头（尤其 Set-Cookie）在 Web Headers 里会被折叠成 ", " 的单串，
  // 直接塞进 writeHead 的普通对象会让多个 Set-Cookie 变成一条而失效。
  // 这里单独取 getSetCookie() 数组逐条写入，其余头逐条 setHeader。
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (setCookies && setCookies.length) raw.setHeader('Set-Cookie', setCookies);
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return; // 已按数组单独处理
    raw.setHeader(key, value);
  });
  raw.writeHead(res.status);

  if (res.body) {
    // Response.body 是 Web ReadableStream，转成 Node 流写出
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  raw.end();
}

// ---- 静态资源 ----

/**
 * 提供静态文件；找不到且有扩展名返回 404，无扩展名则 fallback 到 index.html
 * （支持 vue-router history 模式）。
 *
 * @param {string} pathname 已归一化的路径
 * @param {import('node:http').ServerResponse} raw
 * @returns {Promise<boolean>} 是否已处理
 */
async function serveStatic(pathname, raw) {
  if (!existsSync(WWW_DIR)) {
    raw.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    raw.end('静态资源目录不存在，请先执行前端构建：npm run build');
    return true;
  }

  const hasExt = extname(pathname) !== '';
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');

  // 路径穿越防护：规范化后必须仍位于 WWW_DIR 之内
  const candidate = normalize(join(WWW_DIR, rel));
  if (candidate !== WWW_DIR && !candidate.startsWith(WWW_DIR + sep)) {
    raw.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    raw.end('拒绝访问');
    return true;
  }

  let filePath = candidate;
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    // 正常命中
  } else if (!hasExt && existsSync(join(WWW_DIR, 'index.html'))) {
    // SPA fallback：/admin/console 等前端路由
    filePath = join(WWW_DIR, 'index.html');
  } else {
    raw.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    raw.end('资源不存在');
    return true;
  }

  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
  raw.writeHead(200, { 'Content-Type': type });
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(raw);
  });
  return true;
}

// ---- 服务器 ----

const server = http.createServer(async (req, raw) => {
  try {
    const pathname = normalizePath((req.originalUrl || req.url || '/').split('?')[0]);

    if (pathname.startsWith('/api/')) {
      const request = await toRequest(req);
      const res = await dispatch(request, env);
      await writeResponse(res, raw);
      return;
    }

    await serveStatic(pathname, raw);
  } catch (err) {
    console.error('[server] 请求处理失败:', err);
    if (raw.headersSent) {
      raw.end();
      return;
    }
    const status = err.message === '请求体过大' ? 413 : 500;
    raw.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    raw.end(JSON.stringify({ code: status, message: err.message || '服务器内部错误' }));
  }
});

// 监听错误（EADDRINUSE / 权限等）必须显式处理：否则进程会以未捕异常方式静默退出，
// 容器编排侧看不到明确原因。记录后以非 0 退出码终止。
server.on('error', (err) => {
  const code = err && err.code ? `${err.code}: ` : '';
  console.error('[server] 监听失败:', code + (err && err.message));
  process.exit(1);
});

// 监听：PORT 有值走 TCP（Docker/反代，推荐），否则回退 Unix Socket。
// Socket 模式启动前清理陈旧 socket 避免 EADDRINUSE（见下方 else 分支）。
if (PORT) {
  // 加固：TCP 模式对外暴露端口，此时若同时信任网关身份头，任何人直连即可伪造管理员身份。
  // 故拒绝启动，强制运维二者只选其一。
  if (isTruthy(process.env.TRUST_GATEWAY_HEADERS)) {
    console.error(
      '[server] 拒绝启动：检测到 PORT（对外 TCP 监听）且 TRUST_GATEWAY_HEADERS 为真值(' +
      process.env.TRUST_GATEWAY_HEADERS + ')。' +
      'TCP 暴露时必须关闭网关身份头信任，否则任何人可伪造 X-Trim-Isadmin 头提权为管理员。' +
      '请将 TRUST_GATEWAY_HEADERS 设为 0（或删除该变量）后重启。'
    );
    process.exit(1);
  }
  // TCP 模式（docker / 反代）。TRUST_GATEWAY_HEADERS 必须保持关闭，否则提权风险。
  server.listen(Number(PORT), HOST, () => {
    console.log(`[server] 监听 TCP: ${HOST}:${PORT}`);
    console.log(`[server] 数据库: ${DB_PATH}`);
    console.log(`[server] 静态目录: ${WWW_DIR}`);
    console.log(`[server] 模式: docker(tcp)  TRUST_GATEWAY_HEADERS=${process.env.TRUST_GATEWAY_HEADERS || '0'}`);
  });
} else {
  // Unix Socket 模式（可选）。仅本机/网关可达；如信任前置网关才可开启网关身份头。
  try {
    if (existsSync(SOCKET_PATH)) {
      rmSync(SOCKET_PATH, { force: true });
    }
  } catch (err) {
    console.error('[server] 清理陈旧 Socket 失败:', err.message);
  }
  server.listen(SOCKET_PATH, () => {
  console.log(`[server] 监听 Unix Socket: ${SOCKET_PATH}`);
  console.log(`[server] 数据库: ${DB_PATH}`);
  console.log(`[server] 静态目录: ${WWW_DIR}`);
  });
}

// ---- 优雅停止 ----

let closing = false;
let forceExitTimer = null;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[server] 收到 ${signal}，正在停止...`);

  stopScheduler();

  server.close(() => {
    if (forceExitTimer) {
      clearTimeout(forceExitTimer);
      forceExitTimer = null;
    }
    try {
      driver.close();
    } catch {
      // 忽略关闭异常
    }
    try {
      if (!PORT && existsSync(SOCKET_PATH)) rmSync(SOCKET_PATH, { force: true });
    } catch {
      // 忽略清理异常
    }
    console.log('[server] 已停止');
    process.exit(0);
  });

  // 兜底：5 秒内未关闭则强制退出（在 server.close 回调里清除，避免正常关闭后残留定时器）
  forceExitTimer = setTimeout(() => process.exit(0), 5000);
  forceExitTimer.unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// 未捕获异常不应静默杀死进程且不清理 Socket
process.on('uncaughtException', (err) => {
  console.error('[server] 未捕获异常:', err);
  shutdown('uncaughtException');
});

// ---- 调度器 ----

startScheduler({ env });
console.log('[server] 定时检测调度器已启动');
