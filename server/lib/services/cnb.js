import { getRepoData, saveRepoData } from '../utils/kv.js';
import { fetchWithProxy } from '../utils/index.js';

/**
 * 检测 CNB 仓库代码提交更新
 * @param {{owner: string, repo: string, branch: string}} repoInfo CNB 仓库信息
 * @param {Object} config 配置对象
 * @returns {Promise<Object>}
 */
export async function checkCnbBuildUpdate(repoInfo, config) {
  const { owner, repo, branch } = repoInfo;
  const repoKey = `cnb:${owner}/${repo}@${branch}`;
  const apiBase = config?.cnb?.apiBase || 'https://api.cnb.cool';
  const repoUrl = `https://cnb.cool/${owner}/${repo}`;

  // 验证必需的 CNB Token
  if (!config?.cnb?.token) {
    console.error('CNB_TOKEN 未配置，无法检测 CNB 仓库');

    // 配置缺失同样计入检测状态，避免该仓库在仪表盘上长期显示为空
    await saveRepoData(
      repoKey,
      { lastCheckStatus: 'error', lastCheckError: 'CNB_TOKEN 未配置' },
      { changed: false }
    ).catch(() => {});

    return {
      repo: repoKey,
      platform: 'cnb',
      hasUpdate: false,
      latestSha: '',
      latestDate: '',
      previousSha: '',
      isFirstCheck: false,
      url: repoUrl,
      branch: branch,
      error: 'CNB_TOKEN 未配置'
    };
  }

  // 构建 CNB API 请求（获取提交记录）
  // 注意：CNB Open API 路径为 /{owner}/{repo}/-/git/commits，并非 GitLab 风格 /api/v4/projects/...
  const repoPath = `${owner}/${repo}`;
  const apiUrl = `${apiBase}/${repoPath}/-/git/commits?ref_name=${encodeURIComponent(branch)}&per_page=1`;
  const requestHeaders = {
    'accept': 'application/json',
    'Authorization': `Bearer ${config.cnb.token}`
  };

  let response;

  try {
    // 调用 CNB API（可按平台配置 HTTP 代理）
    response = await fetchWithProxy(apiUrl, { headers: requestHeaders }, config?.cnb?.proxy);

    // 检查 API 响应状态
    if (!response.ok) {
      throw new Error(`CNB API 请求失败: ${response.status} ${response.statusText}`);
    }

    // 解析 API 响应
    const data = await response.json();

    // 获取最新提交信息
    if (!data || data.length === 0) {
      console.log(`CNB 仓库 ${repoKey} 暂无提交记录`);

      // 空仓库也是一次有效检测，记录状态而非错误
      await saveRepoData(
        repoKey,
        { lastCheckStatus: 'ok', lastCheckError: null },
        { changed: false }
      ).catch(() => {});

      return {
        repo: repoKey,
        platform: 'cnb',
        hasUpdate: false,
        latestSha: '',
        latestDate: '',
        previousSha: '',
        isFirstCheck: true,
        url: repoUrl,
        branch: branch,
        error: '暂无提交记录'
      };
    }

    const latestCommit = data[0];
    const latestSha = latestCommit.sha || latestCommit.id;
    const latestDate = latestCommit.commit?.author?.date || latestCommit.created_at || latestCommit.committed_date || new Date().toISOString();
    const latestMessage = latestCommit.commit?.message || latestCommit.message || latestCommit.title || '';
    const authorName = latestCommit.commit?.author?.name || latestCommit.author_name || latestCommit.author?.name || '';

    // 从 KV 获取上次记录的数据（使用全局变量）
    const previousData = await getRepoData(repoKey, 'cnb');
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
          ? { sha: latestSha, date: latestDate, message: latestMessage, author: authorName, url: repoUrl }
          : {})
      },
      { changed: isFirstCheck || hasUpdate }
    );

    return {
      repo: repoKey,
      platform: 'cnb',
      hasUpdate,
      latestSha,
      latestDate,
      latestMessage,
      authorName,
      previousSha,
      isFirstCheck,
      url: repoUrl,
      branch: branch
    };
  } catch (error) {
    console.error(`检测 CNB 仓库 ${repoKey} 失败:`, error);
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
      platform: 'cnb',
      hasUpdate: false,
      latestSha: '',
      latestDate: '',
      previousSha,
      url: repoUrl,
      branch: branch,
      error: error.message
    };
  }
}

