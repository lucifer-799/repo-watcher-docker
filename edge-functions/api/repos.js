/**
 * 获取仓库列表和状态（**匿名可读**，只读端点）
 *
 * 访问路径: GET /api/repos
 * 1.0.1 起：仪表盘对未登录用户开放，本端点允许匿名只读访问。
 * 安全边界：返回字段仅含仓库标识/分支/最近提交与状态，**不含任何凭据（token/密钥/密码）**，
 *          故匿名读取不会泄露敏感信息；所有写/管理操作在 /api/admin/* 等端点仍需登录。
 * 若请求携带有效令牌，本端点行为不变（返回内容一致）。
 * 配置来源：KV（repo_watcher_config，自动解密；仅取 repos 结构，不回传 token 字段）
 */

import { normalizeRepos, getRepoData, resolveSource, buildRepoDataKey } from '../lib/utils/index.js';
import { getConfig } from '../lib/config.js';
import { requireAccess, json } from '../lib/auth/middleware.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  // 1.0.1：只读端点允许匿名访问（仪表盘可见）；1.0.2 起按登录态差异化返回：
  // 匿名用户拿不到 lastCheckError（可能含本地路径/内部错误细节），登录后才返回。
  // 本端点只读仓库状态、绝不回传 token/密钥，故匿名读取安全。
  const auth = await requireAccess(request, env).catch(() => ({ ok: false }));
  const isAuthed = !!(auth && auth.ok);

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };

  try {
    const config = await getConfig(context.env);
    const repos = [];

    // 获取 GitHub 仓库列表
    const githubRepos = normalizeRepos(config.github?.repos, config.github?.branch || 'main');
    for (const repo of githubRepos) {
      const source = resolveSource('github', repo);
      const repoKey = buildRepoDataKey('github', repo, source);
      const repoUrl = `https://github.com/${repo.owner}/${repo.repo}`;
      const repoData = await getRepoData(repoKey);

      repos.push({
        platform: 'github',
        name: `${repo.owner}/${repo.repo}`,
        branch: repo.branch,
        note: repo.note || null,
        key: repoKey,
        url: repoUrl,
        source,
        includePrerelease: repo.includePrerelease === true,
        latestSha: repoData?.sha || null,
        latestTag: repoData?.tag || null,
        latestReleaseName: repoData?.name || null,
        releaseUrl: repoData?.releaseUrl || null,
        latestDate: repoData?.date || null,
        updatedAt: repoData?.updatedAt || null,
        lastCheckedAt: repoData?.lastCheckedAt || null,
        lastCheckStatus: repoData?.lastCheckStatus || null,
        lastCheckError: isAuthed ? (repoData?.lastCheckError || null) : null,
        hasUpdate: false
      });
    }

    // 获取 Gitee 仓库列表
    const giteeRepos = normalizeRepos(config.gitee?.repos, config.gitee?.branch || 'master');
    for (const repo of giteeRepos) {
      const source = resolveSource('gitee', repo);
      const repoKey = buildRepoDataKey('gitee', repo, source);
      const repoUrl = `https://gitee.com/${repo.owner}/${repo.repo}`;
      const repoData = await getRepoData(repoKey);

      repos.push({
        platform: 'gitee',
        name: `${repo.owner}/${repo.repo}`,
        branch: repo.branch,
        note: repo.note || null,
        key: repoKey,
        url: repoUrl,
        source,
        includePrerelease: repo.includePrerelease === true,
        latestSha: repoData?.sha || null,
        latestTag: repoData?.tag || null,
        latestReleaseName: repoData?.name || null,
        releaseUrl: repoData?.releaseUrl || null,
        latestDate: repoData?.date || null,
        latestMessage: repoData?.message || null,
        authorName: repoData?.author || null,
        updatedAt: repoData?.updatedAt || null,
        lastCheckedAt: repoData?.lastCheckedAt || null,
        lastCheckStatus: repoData?.lastCheckStatus || null,
        lastCheckError: isAuthed ? (repoData?.lastCheckError || null) : null,
        hasUpdate: false
      });
    }

    // 获取 GitLab 仓库列表
    const gitlabHost = config.gitlab?.host || 'gitlab.com';
    const gitlabRepos = normalizeRepos(config.gitlab?.repos, config.gitlab?.branch || 'main');
    for (const repo of gitlabRepos) {
      const source = resolveSource('gitlab', repo);
      const repoKey = buildRepoDataKey('gitlab', repo, source);
      const repoUrl = `https://${gitlabHost}/${repo.owner}/${repo.repo}`;
      const repoData = await getRepoData(repoKey);

      repos.push({
        platform: 'gitlab',
        name: `${repo.owner}/${repo.repo}`,
        branch: repo.branch,
        note: repo.note || null,
        key: repoKey,
        url: repoUrl,
        source,
        includePrerelease: repo.includePrerelease === true,
        latestSha: repoData?.sha || null,
        latestTag: repoData?.tag || null,
        latestReleaseName: repoData?.name || null,
        releaseUrl: repoData?.releaseUrl || null,
        latestDate: repoData?.date || null,
        latestMessage: repoData?.message || null,
        authorName: repoData?.author || null,
        updatedAt: repoData?.updatedAt || null,
        lastCheckedAt: repoData?.lastCheckedAt || null,
        lastCheckStatus: repoData?.lastCheckStatus || null,
        lastCheckError: isAuthed ? (repoData?.lastCheckError || null) : null,
        hasUpdate: false
      });
    }

    // 获取 GitCode 仓库列表
    const gitcodeHost = config.gitcode?.host || 'gitcode.com';
    const gitcodeRepos = normalizeRepos(config.gitcode?.repos, config.gitcode?.branch || 'main');
    for (const repo of gitcodeRepos) {
      const source = resolveSource('gitcode', repo);
      const repoKey = buildRepoDataKey('gitcode', repo, source);
      const repoUrl = `https://${gitcodeHost}/${repo.owner}/${repo.repo}`;
      const repoData = await getRepoData(repoKey);

      repos.push({
        platform: 'gitcode',
        name: `${repo.owner}/${repo.repo}`,
        branch: repo.branch,
        note: repo.note || null,
        key: repoKey,
        url: repoUrl,
        source,
        includePrerelease: repo.includePrerelease === true,
        latestSha: repoData?.sha || null,
        latestTag: repoData?.tag || null,
        latestReleaseName: repoData?.name || null,
        releaseUrl: repoData?.releaseUrl || null,
        latestDate: repoData?.date || null,
        latestMessage: repoData?.message || null,
        authorName: repoData?.author || null,
        updatedAt: repoData?.updatedAt || null,
        lastCheckedAt: repoData?.lastCheckedAt || null,
        lastCheckStatus: repoData?.lastCheckStatus || null,
        lastCheckError: isAuthed ? (repoData?.lastCheckError || null) : null,
        hasUpdate: false
      });
    }

    // 获取 CNB 仓库列表
    const cnbRepos = normalizeRepos(config.cnb?.repos, config.cnb?.branch || 'main');
    for (const repo of cnbRepos) {
      const source = resolveSource('cnb', repo);
      const repoKey = buildRepoDataKey('cnb', repo, source);
      const repoUrl = `https://cnb.cool/${repo.owner}/${repo.repo}`;
      const repoData = await getRepoData(repoKey);

      repos.push({
        platform: 'cnb',
        name: `${repo.owner}/${repo.repo}`,
        branch: repo.branch,
        note: repo.note || null,
        key: repoKey,
        url: repoUrl,
        source,
        includePrerelease: repo.includePrerelease === true,
        latestSha: repoData?.sha || null,
        latestTag: repoData?.tag || null,
        latestReleaseName: repoData?.name || null,
        releaseUrl: repoData?.releaseUrl || null,
        latestDate: repoData?.date || null,
        latestMessage: repoData?.message || null,
        authorName: repoData?.author || null,
        updatedAt: repoData?.updatedAt || null,
        lastCheckedAt: repoData?.lastCheckedAt || null,
        lastCheckStatus: repoData?.lastCheckStatus || null,
        lastCheckError: isAuthed ? (repoData?.lastCheckError || null) : null,
        hasUpdate: false
      });
    }

    // 聚合全局检测状态：取所有仓库中最新的 lastCheckedAt，
    // 用于判断检测任务（外部 Cron）是否仍在正常运行。
    // ISO 8601 字符串可直接按字典序比较。
    const lastCheckedAt = repos.reduce((latest, repo) => {
      if (!repo.lastCheckedAt) return latest;
      return !latest || repo.lastCheckedAt > latest ? repo.lastCheckedAt : latest;
    }, null);

    const failed = repos.filter(r => r.lastCheckStatus === 'error').length;

    return new Response(JSON.stringify({
      code: 200,
      message: '获取成功',
      data: {
        total: repos.length,
        lastCheckedAt,
        failed,
        github: repos.filter(r => r.platform === 'github').length,
        gitee: repos.filter(r => r.platform === 'gitee').length,
        gitlab: repos.filter(r => r.platform === 'gitlab').length,
        gitcode: repos.filter(r => r.platform === 'gitcode').length,
        cnb: repos.filter(r => r.platform === 'cnb').length,
        repos: repos
      }
    }, null, 2), { headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({
      code: 500,
      message: '获取失败',
      error: error.message
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
}

// 处理预检请求
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
