import { getRepoData, saveRepoData } from '../utils/kv.js';
import { fetchWithProxy } from '../utils/index.js';

/**
 * 解析单个 GitCode 仓库字符串（格式：owner/repo 或 owner/repo@branch）
 * @param {string} repoStr 单个仓库字符串
 * @param {string} defaultBranch 默认分支
 * @returns {{owner: string, repo: string, branch: string}|null}
 */
export function parseGitCodeRepoString(repoStr, defaultBranch) {
  const parts = repoStr.split('@');
  const repoParts = parts[0].split('/');

  if (repoParts.length !== 2) return null;

  return {
    owner: repoParts[0].trim(),
    repo: repoParts[1].trim(),
    branch: parts.length > 1 ? parts[1].trim() : defaultBranch
  };
}

/**
 * 检测单个 GitCode 仓库是否有更新
 * GitCode 提供 Gitee 风格（/api/v5）接口：GET /api/v5/repos/{owner}/{repo}/commits/{branch}
 * 鉴权使用 access_token 查询参数（公开仓库可免 token）。响应结构与 Gitee 一致：
 * 顶层 sha、嵌套 commit.author.date / commit.message。
 * @param {{owner: string, repo: string, branch: string}} repoInfo 仓库信息
 * @param {Object} config 配置对象
 * @returns {Promise<Object>}
 */
export async function checkGitCodeRepoUpdate(repoInfo, config) {
  const { owner, repo, branch } = repoInfo;
  const repoKey = `gitcode:${owner}/${repo}@${branch}`;
  const apiBase = config?.gitcode?.apiBase || 'https://gitcode.com';
  const gitcodeHost = config?.gitcode?.host || 'gitcode.com';
  const repoUrl = `https://${gitcodeHost}/${owner}/${repo}`;

  // 构建 GitCode API 请求（Gitee 风格 /api/v5，owner/repo 为普通路径，不做编码）
  const apiUrl = `${apiBase}/api/v5/repos/${owner}/${repo}/commits/${branch}`;
  const requestHeaders = {
    'User-Agent': 'GitCode-Repo-Watcher-EdgeOne-Makers',
  };

  // GitCode 使用 access_token 查询参数认证（公开仓库无需 token）
  let requestUrl = apiUrl;
  if (config?.gitcode?.token) {
    requestUrl = `${apiUrl}?access_token=${encodeURIComponent(config.gitcode.token)}`;
  }

  let response;

  try {
    // 调用 GitCode API（可按平台配置 HTTP 代理）
    response = await fetchWithProxy(requestUrl, { headers: requestHeaders }, config?.gitcode?.proxy);

    // 检查 API 响应状态
    if (!response.ok) {
      throw new Error(`GitCode API 请求失败: ${response.status} ${response.statusText}`);
    }

    // 解析 API 响应（Gitee 风格：顶层 sha，commit.author.date，commit.message）
    const data = await response.json();
    const latestSha = data.sha;
    const latestDate = data.commit?.author?.date || data.commit?.committer?.date || new Date().toISOString();
    const commitMessage = data.commit?.message || '';

    // 从 KV 获取上次记录的数据
    const previousData = await getRepoData(repoKey, 'gitcode');
    const previousSha = previousData && typeof previousData === 'object'
      ? (previousData.sha || null)
      : (previousData || null);

    // 判断是否有更新
    const hasUpdate = previousSha && previousSha.length > 0 ? previousSha !== latestSha : false;

    // 判断是否首次检测
    const isFirstCheck = !previousSha || previousSha.length === 0;

    // 写入检测结果：有变化（含首次）时更新提交快照；检测状态每次都记录
    await saveRepoData(
      repoKey,
      {
        lastCheckStatus: 'ok',
        lastCheckError: null,
        ...(isFirstCheck || hasUpdate
          ? { sha: latestSha, date: latestDate, message: commitMessage, url: repoUrl, branch: branch }
          : {})
      },
      { changed: isFirstCheck || hasUpdate }
    );

    return {
      repo: repoKey,
      platform: 'gitcode',
      hasUpdate,
      latestSha,
      latestDate,
      commitMessage,
      previousSha,
      isFirstCheck,
      url: repoUrl
    };
  } catch (error) {
    console.error(`检测 GitCode 仓库 ${repoKey} 失败:`, error);
    const previousData = await getRepoData(repoKey);
    const previousSha = previousData && typeof previousData === 'object'
      ? (previousData.sha || null)
      : (previousData || null);

    // 记录本次检测失败，保留已有的 sha，便于仪表盘区分「无更新」与「检测失败」
    await saveRepoData(
      repoKey,
      { lastCheckStatus: 'error', lastCheckError: error.message },
      { changed: false }
    ).catch(() => {});

    return {
      repo: repoKey,
      platform: 'gitcode',
      hasUpdate: false,
      latestSha: '',
      latestDate: '',
      previousSha,
      url: repoUrl,
      error: error.message
    };
  }
}

/**
 * 获取 GitCode API 限流信息（GitCode 未公开稳定限流接口，失败时返回未知）
 * @param {Object} config 配置对象
 * @returns {Promise<Object>}
 */
export async function getGitCodeRateLimitInfo(config) {
  const apiBase = config?.gitcode?.apiBase || 'https://gitcode.com';
  const requestHeaders = {
    'User-Agent': 'GitCode-Repo-Watcher-EdgeOne-Makers',
  };

  let requestUrl = `${apiBase}/api/v5/rate_limit`;
  if (config?.gitcode?.token) {
    requestUrl = `${requestUrl}?access_token=${encodeURIComponent(config.gitcode.token)}`;
  }

  try {
    const response = await fetchWithProxy(requestUrl, { headers: requestHeaders }, config?.gitcode?.proxy);
    const data = await response.json();
    return {
      limit: data.rate?.limit?.toString() || '未知',
      remaining: data.rate?.remaining?.toString() || '未知',
      reset: data.rate?.reset ? new Date(data.rate.reset * 1000).toISOString() : '未知'
    };
  } catch (error) {
    return { limit: '未知', remaining: '未知', reset: '未知' };
  }
}
