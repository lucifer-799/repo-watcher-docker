import { getRepoData, saveRepoData } from '../utils/kv.js';
import { buildRepoDataKey, SOURCE_RELEASE } from '../utils/parser.js';
import { fetchWithProxy } from '../utils/index.js';

/**
 * Release 检测（GitHub / Gitee / GitLab / GitCode）
 *
 * 与 commit 检测的区别：
 *   - 比对值为 release 的 tag_name，而非 commit SHA
 *   - Release 属于仓库级资源、不绑定分支，故 KV 键不分支名
 *   - 「仓库尚未发布任何 Release」属正常空态，不判为检测失败
 *   - KV 记录中带 source 字段，切换检测依据时会重置基线，避免用 tag 比对 sha
 *
 * KV 记录结构：
 *   { source: 'release', tag, releaseId, date, name, url, releaseUrl,
 *     lastCheckStatus, lastCheckError, updatedAt, lastCheckedAt }
 */

// 追加查询参数：自动识别 URL 是否已带 query，避免拼出 "/path&token=x"
function appendQuery(url, addition) {
  if (!addition) return url;
  return url.includes('?') ? `${url}&${addition}` : `${url}?${addition}`;
}

// 各平台 release 端点与响应字段差异的适配表
const PLATFORM_ADAPTERS = {
  github: {
    // 仅正式版走 /releases/latest；含预发布需取列表首条
    buildLatest: (base, path) => `${base}/repos/${path}/releases/latest`,
    buildList: (base, path) => `${base}/repos/${path}/releases?per_page=1`,
    buildHeaders: (token) => ({
      'User-Agent': 'Repo-Watcher-Docker',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    }),
    getToken: (config) => config?.github?.token,
    apiBase: () => 'https://api.github.com',
    repoUrl: (owner, repo) => `https://github.com/${owner}/${repo}`,
  },
  gitee: {
    buildLatest: (base, path) => `${base}/api/v5/repos/${path}/releases/latest`,
    buildList: (base, path) => `${base}/api/v5/repos/${path}/releases?per_page=1`,
    buildHeaders: () => ({ 'User-Agent': 'Repo-Watcher-Docker' }),
    getToken: (config) => config?.gitee?.token,
    apiBase: () => 'https://gitee.com',
    repoUrl: (owner, repo) => `https://gitee.com/${owner}/${repo}`,
    // Gitee 通过 URL 参数认证
    authQuery: (token) => (token ? `private_token=${encodeURIComponent(token)}` : ''),
  },
  gitlab: {
    // GitLab 无 latest 端点，两种情况都取列表首条
    buildLatest: (base, path) => `${base}/api/v4/projects/${path}/releases?per_page=1`,
    buildList: (base, path) => `${base}/api/v4/projects/${path}/releases?per_page=1`,
    buildHeaders: (token) => ({
      'User-Agent': 'Repo-Watcher-Docker',
      ...(token ? { 'PRIVATE-TOKEN': token } : {}),
    }),
    getToken: (config) => config?.gitlab?.token,
    apiBase: (config) => config?.gitlab?.apiBase || 'https://gitlab.com',
    repoUrl: (owner, repo, config) => `https://${config?.gitlab?.host || 'gitlab.com'}/${owner}/${repo}`,
  },
  gitcode: {
    // GitCode 兼容 Gitee，无 latest 端点，两种情况都取列表首条
    buildLatest: (base, path) => `${base}/api/v5/repos/${path}/releases?per_page=1`,
    buildList: (base, path) => `${base}/api/v5/repos/${path}/releases?per_page=1`,
    buildHeaders: () => ({
      'User-Agent': 'Repo-Watcher-Docker',
    }),
    getToken: (config) => config?.gitcode?.token,
    apiBase: (config) => config?.gitcode?.apiBase || 'https://gitcode.com',
    repoUrl: (owner, repo, config) => `https://${config?.gitcode?.host || 'gitcode.com'}/${owner}/${repo}`,
    authQuery: (token) => (token ? `access_token=${encodeURIComponent(token)}` : ''),
  },
  cnb: {
    // CNB Open API 路径为 /{owner}/{repo}/-/releases（非 GitLab 风格）
    buildLatest: (base, path) => `${base}/${path}/-/releases/latest`,
    buildList: (base, path) => `${base}/${path}/-/releases?per_page=1`,
    buildHeaders: (token) => ({
      'accept': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    }),
    getToken: (config) => config?.cnb?.token,
    apiBase: () => 'https://api.cnb.cool',
    repoUrl: (owner, repo) => `https://cnb.cool/${owner}/${repo}`,
    // CNB release 对象无 html_url，需自行拼装页面地址
    extract: (data, repoInfo) => ({
      tag: data?.tag_name || '',
      name: data?.name || '',
      date: data?.published_at || data?.created_at || new Date().toISOString(),
      releaseUrl: `https://cnb.cool/${repoInfo.owner}/${repoInfo.repo}/-/releases/${encodeURIComponent(data?.tag_name || '')}`,
      releaseId: data?.id ?? null,
    }),
  },
};

/**
 * 从响应体中抽取统一的 release 信息
 * @param {Object} data 单条 release 对象
 * @returns {{tag: string, name: string, date: string, releaseUrl: string, releaseId: string|number|null}}
 */
function extractRelease(data) {
  return {
    tag: data?.tag_name || '',
    name: data?.name || '',
    date: data?.published_at || data?.created_at || data?.createdAt || new Date().toISOString(),
    releaseUrl: data?.html_url || data?._links?.self || '',
    releaseId: data?.id ?? null,
  };
}

/**
 * 三平台共用的 release 检测流程
 *
 * @param {'github'|'gitee'|'gitlab'|'gitcode'} platform 平台标识
 * @param {{owner: string, repo: string, branch: string, source: string, includePrerelease: boolean}} repoInfo
 * @param {Object} config 配置对象
 * @returns {Promise<Object>} 检测结果
 */
async function checkRelease(platform, repoInfo, config) {
  const { owner, repo, includePrerelease } = repoInfo;
  const adapter = PLATFORM_ADAPTERS[platform];
  const repoKey = buildRepoDataKey(platform, repoInfo, SOURCE_RELEASE);
  const repoUrl = adapter.repoUrl(owner, repo, config);
  const token = adapter.getToken(config);
  const apiBase = adapter.apiBase(config);
  // 按平台读取独立的 HTTP 代理配置
  const proxy = config?.[platform]?.proxy;
  // 仅 GitLab 的项目路径需编码 owner/repo，GitHub / Gitee / GitCode 用普通路径
  const encodedPath = platform === 'gitlab'
    ? encodeURIComponent(`${owner}/${repo}`)
    : `${owner}/${repo}`;

  const baseResult = {
    repo: repoKey,
    platform,
    source: 'release',
    url: repoUrl,
    hasUpdate: false,
    latestTag: '',
    previousTag: '',
    latestDate: '',
    releaseName: '',
    releaseUrl: '',
    isFirstCheck: false,
  };

  // 空态：仓库尚未发布任何 Release，属正常状态而非错误
  async function emptyResult(previous) {
    const sourceSwitched = previous?.source !== 'release';
    await saveRepoData(
      repoKey,
      {
        source: 'release',
        tag: '',
        releaseId: null,
        date: '',
        name: '',
        url: repoUrl,
        releaseUrl: '',
        lastCheckStatus: 'ok',
        lastCheckError: null,
      },
      { changed: sourceSwitched }
    );
    return {
      ...baseResult,
      isFirstCheck: sourceSwitched,
      previousTag: sourceSwitched ? '' : (previous?.tag || ''),
    };
  }

  try {
    // 仅正式版走 latest 端点（GitLab 无 latest，适配器已将其指向列表首条）
    const url = includePrerelease
      ? adapter.buildList(apiBase, encodedPath)
      : adapter.buildLatest(apiBase, encodedPath);
    const requestUrl = adapter.authQuery
      ? appendQuery(url, adapter.authQuery(token))
      : url;

    const response = await fetchWithProxy(requestUrl, { headers: adapter.buildHeaders(token) }, proxy);

    // GitHub 的 /releases/latest 在无任何 Release 时返回 404
    if (response.status === 404) {
      return await emptyResult(await getRepoData(repoKey));
    }

    if (!response.ok) {
      throw new Error(`${platform} Release API 请求失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const latest = Array.isArray(data) ? data[0] : data;

    // GitLab 在无 Release 时返回空数组
    if (!latest) {
      return await emptyResult(await getRepoData(repoKey));
    }

    const { tag: latestTag, name: releaseName, date: latestDate, releaseUrl, releaseId } = adapter.extract
      ? adapter.extract(latest, repoInfo)
      : extractRelease(latest);

    const previousData = await getRepoData(repoKey);
    // 切换检测依据（commit ↔ release）时重置基线，避免用 tag 比对 sha
    const sourceSwitched = previousData?.source !== 'release';
    const previousTag = sourceSwitched ? '' : (previousData?.tag || '');

    const isFirstCheck = !previousTag || previousTag.length === 0;
    const hasUpdate = !isFirstCheck && previousTag !== latestTag;
    const changed = isFirstCheck || hasUpdate;

    await saveRepoData(
      repoKey,
      {
        source: 'release',
        tag: latestTag,
        releaseId,
        date: latestDate,
        name: releaseName,
        url: repoUrl,
        releaseUrl,
        lastCheckStatus: 'ok',
        lastCheckError: null,
      },
      { changed }
    );

    return {
      ...baseResult,
      hasUpdate,
      isFirstCheck,
      latestTag,
      previousTag,
      latestDate,
      releaseName,
      releaseUrl,
    };
  } catch (error) {
    console.error(`检测 ${platform} 仓库 ${repoKey} 的 Release 失败:`, error);
    const previousData = await getRepoData(repoKey).catch(() => null);

    // 保留已有 tag，仅记录错误
    await saveRepoData(
      repoKey,
      { source: 'release', lastCheckStatus: 'error', lastCheckError: error.message },
      { changed: false }
    ).catch(() => {});

    return {
      ...baseResult,
      latestTag: previousData?.tag || '',
      previousTag: previousData?.tag || '',
      latestDate: previousData?.date || '',
      releaseName: previousData?.name || '',
      releaseUrl: previousData?.releaseUrl || '',
      error: error.message,
    };
  }
}

/**
 * 检测 GitHub 仓库的 Release 更新
 */
export function checkGitHubRelease(repoInfo, config) {
  return checkRelease('github', repoInfo, config);
}

/**
 * 检测 Gitee 仓库的 Release 更新
 */
export function checkGiteeRelease(repoInfo, config) {
  return checkRelease('gitee', repoInfo, config);
}

/**
 * 检测 GitLab 仓库的 Release 更新
 */
export function checkGitLabRelease(repoInfo, config) {
  return checkRelease('gitlab', repoInfo, config);
}

/**
 * 检测 CNB 仓库的 Release 更新
 */
export function checkCnbRelease(repoInfo, config) {
  return checkRelease('cnb', repoInfo, config);
}

/**
 * 检测 GitCode 仓库的 Release 更新
 */
export function checkGitCodeRelease(repoInfo, config) {
  return checkRelease('gitcode', repoInfo, config);
}
