import { getRepoData, saveRepoData, fetchWithProxy } from '../utils/index.js';

/**
 * 检测单个仓库是否有更新
 * @param {{owner: string, repo: string, branch: string}} repoInfo 仓库信息
 * @param {Object} config 配置对象（来自 KV，已解密）
 * @returns {Promise<Object>}
 */
export async function checkRepoUpdate(repoInfo, config) {
  const { owner, repo, branch } = repoInfo;
  const repoKey = `${owner}/${repo}@${branch}`;
  const repoUrl = `https://github.com/${owner}/${repo}`;

  // 构建 GitHub API 请求
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`;
  const requestHeaders = {
    'User-Agent': 'GitHub-Repo-Watcher-EdgeOne-Makers',
  };

  // 判断是否启用认证
  if (config?.github?.token) {
    requestHeaders['Authorization'] = `Bearer ${config.github.token}`;
  }

  let response;

  try {
    // 调用 GitHub API（可按平台配置 HTTP 代理）
    response = await fetchWithProxy(apiUrl, { headers: requestHeaders }, config?.github?.proxy);

    // 检查 API 响应状态
    if (!response.ok) {
      throw new Error(`GitHub API 请求失败: ${response.status} ${response.statusText}`);
    }

    // 解析 API 响应
    const data = await response.json();
    const latestSha = data.sha;
    const latestDate = data.commit.author.date;
    const commitMessage = data.commit.message;

    // 从 KV 获取上次记录的数据（使用全局变量）
    const previousData = await getRepoData(repoKey, 'github');
    const previousSha = previousData && typeof previousData === 'object'
      ? (previousData.sha || null)
      : (previousData || null);

    // 判断是否有更新
    const hasUpdate = previousSha && previousSha.length > 0 ? previousSha !== latestSha : false;

    // 判断是否首次检测（用于通知控制）
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
      platform: 'github',
      hasUpdate,
      latestSha,
      latestDate,
      commitMessage,
      previousSha,
      isFirstCheck,
      url: repoUrl
    };
  } catch (error) {
    console.error(`检测仓库 ${repoKey} 失败:`, error);
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
      platform: 'github',
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
 * 获取 GitHub API 限流信息
 * @param {Object} config 配置对象
 * @returns {Promise<Object>}
 */
export async function getRateLimitInfo(config) {
  const requestHeaders = {
    'User-Agent': 'GitHub-Repo-Watcher-EdgeOne-Makers',
  };

  if (config?.github?.token) {
    requestHeaders['Authorization'] = `Bearer ${config.github.token}`;
  }

  try {
    const response = await fetchWithProxy('https://api.github.com/rate_limit', { headers: requestHeaders }, config?.github?.proxy);
    const data = await response.json();
    return {
      limit: data.rate.limit.toString(),
      remaining: data.rate.remaining.toString(),
      reset: new Date(data.rate.reset * 1000).toISOString()
    };
  } catch (error) {
    return { limit: '未知', remaining: '未知', reset: '未知' };
  }
}

