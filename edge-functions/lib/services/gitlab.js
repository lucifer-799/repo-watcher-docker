import { getRepoData, saveRepoData } from '../utils/kv.js';
import { fetchWithProxy } from '../utils/index.js';

/**
 * 解析单个 GitLab 仓库字符串（格式：owner/repo 或 owner/repo@branch）
 * @param {string} repoStr 单个仓库字符串
 * @param {string} defaultBranch 默认分支
 * @returns {{owner: string, repo: string, branch: string}|null}
 */
export function parseGitLabRepoString(repoStr, defaultBranch) {
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
 * 检测单个 GitLab 仓库是否有更新
 * @param {{owner: string, repo: string, branch: string}} repoInfo 仓库信息
 * @param {Object} config 配置对象
 * @returns {Promise<Object>}
 */
export async function checkGitLabRepoUpdate(repoInfo, config) {
  const { owner, repo, branch } = repoInfo;
  const repoKey = `gitlab:${owner}/${repo}@${branch}`;
  const apiBase = config?.gitlab?.apiBase || 'https://gitlab.com';
  const gitlabHost = config?.gitlab?.host || 'gitlab.com';
  const repoUrl = `https://${gitlabHost}/${owner}/${repo}`;

  // URL 编码项目路径 (owner/repo -> owner%2Frepo)
  const encodedPath = encodeURIComponent(`${owner}/${repo}`);

  // 构建 GitLab API 请求
  const apiUrl = `${apiBase}/api/v4/projects/${encodedPath}/repository/commits/${branch}`;
  const requestHeaders = {
    'User-Agent': 'GitLab-Repo-Watcher-EdgeOne-Makers',
  };

  // GitLab 使用 PRIVATE-TOKEN header 认证
  if (config?.gitlab?.token) {
    requestHeaders['PRIVATE-TOKEN'] = config.gitlab.token;
  }

  let response;

  try {
    // 调用 GitLab API（可按平台配置 HTTP 代理）
    response = await fetchWithProxy(apiUrl, { headers: requestHeaders }, config?.gitlab?.proxy);

    // 检查 API 响应状态
    if (!response.ok) {
      throw new Error(`GitLab API 请求失败: ${response.status} ${response.statusText}`);
    }

    // 解析 API 响应
    const data = await response.json();
    const latestSha = data.id;
    const latestDate = data.created_at || data.committed_date || new Date().toISOString();
    const commitMessage = data.message || '';

    // 从 KV 获取上次记录的数据（使用全局变量）
    const previousData = await getRepoData(repoKey, 'gitlab');
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
      platform: 'gitlab',
      hasUpdate,
      latestSha,
      latestDate,
      commitMessage,
      previousSha,
      isFirstCheck,
      url: repoUrl
    };
  } catch (error) {
    console.error(`检测 GitLab 仓库 ${repoKey} 失败:`, error);
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
      platform: 'gitlab',
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
 * 获取 GitLab API 限流信息
 * @param {Object} config 配置对象
 * @returns {Promise<Object>}
 */
export async function getGitLabRateLimitInfo(config) {
  const apiBase = config?.gitlab?.apiBase || 'https://gitlab.com';
  const requestHeaders = {
    'User-Agent': 'GitLab-Repo-Watcher-EdgeOne-Makers',
  };

  if (config?.gitlab?.token) {
    requestHeaders['PRIVATE-TOKEN'] = config.gitlab.token;
  }

  try {
    // GitLab 不提供专门的 rate limit API，通过请求 headers 获取限流信息
    const response = await fetchWithProxy(`${apiBase}/api/v4/projects?per_page=1`, { headers: requestHeaders }, config?.gitlab?.proxy);

    // GitLab 在响应头中返回限流信息
    const rateLimitLimit = response.headers.get('ratelimit-limit') || response.headers.get('x-ratelimit-limit') || '未知';
    const rateLimitRemaining = response.headers.get('ratelimit-remaining') || response.headers.get('x-ratelimit-remaining') || '未知';
    const rateLimitReset = response.headers.get('ratelimit-reset') || response.headers.get('x-ratelimit-reset');

    return {
      limit: rateLimitLimit,
      remaining: rateLimitRemaining,
      reset: rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000).toISOString() : '未知'
    };
  } catch (error) {
    return { limit: '未知', remaining: '未知', reset: '未知' };
  }
}
