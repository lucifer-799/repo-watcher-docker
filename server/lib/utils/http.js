/**
 * HTTP 客户端抽象层（运行时无关）
 *
 * 让业务服务（各平台 API 检测）统一经由 fetchWithProxy(url, init, proxyUrl)
 * 发起请求，而不直接调用全局 fetch。这样可以在「需要代理」时由上层注入
 * 真正的代理实现，业务层无感知。
 *
 * 为什么需要这一层？
 *  - 自托管 Node 运行时（Docker 版）：服务端在启动时通过 setFetchClient 注入
 *    基于 node:http CONNECT 隧道的实现，从而真正支持 HTTP/HTTPS 代理
 *    （见 server/http-client.js）。这对于「国内访问 GitHub 不佳」等场景尤为关键。
 *  - 默认实现：若未注入自定义 fetch 客户端（server/index.js 会注入带代理的实现），
 *    并在首次遇到非空 proxyUrl 时打印一条警告（仅一次）。
 *
 * 注入式设计与存储驱动（setStorageDriver）保持一致：业务层不感知运行时差异。
 *
 * 注意：本文件不引入 node: 内置模块（保持纯 Web API，便于测试）
 * （构建时由打包自检保证）。
 */

let fetchClient = defaultFetchClient;
let warnedProxyUnsupported = false;

/**
 * 默认实现：直连（未注入自定义客户端时使用）。
 * @param {string} url
 * @param {object} [init]
 * @param {string} [proxyUrl]
 * @returns {Promise<Response>}
 */
async function defaultFetchClient(url, init, proxyUrl) {
  if (proxyUrl) {
    if (!warnedProxyUnsupported) {
      warnedProxyUnsupported = true;
      console.warn(
        '[http] 检测到已配置 HTTP 代理，但未注入支持代理的 fetch 客户端，将直连（忽略代理），' +
        '已改为直连。如需为 GitHub 等平台配置代理，请改用自托管 Node 自托管部署。'
      );
    }
  }
  return fetch(url, init || {});
}

/**
 * 注入自定义的 HTTP 客户端（仅 Node 自托管运行时需要）。
 * @param {(url: string, init?: object, proxyUrl?: string) => Promise<Response>} fn
 */
export function setFetchClient(fn) {
  if (typeof fn === 'function') fetchClient = fn;
}

/** 取当前生效的 HTTP 客户端（测试/调试用）。 */
export function getFetchClient() {
  return fetchClient;
}

/**
 * 统一请求入口：业务服务一律调用本函数。
 * @param {string} url
 * @param {object} [init]
 * @param {string} [proxyUrl]
 * @returns {Promise<Response>}
 */
export async function fetchWithProxy(url, init, proxyUrl) {
  return fetchClient(url, init || {}, proxyUrl || '');
}
