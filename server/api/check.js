/**
 * 检测接口
 *
 * 访问路径:
 *   - GET /api/check - 手动检测
 *   - POST /api/check - 定时任务触发
 *
 * 参数:
 *   - repo: 指定仓库名称 (owner/repo 或 owner/repo@branch)
 *   - type: 指定平台 (all/github/gitee/gitlab/gitcode/cnb)
 *   - notify=true: 检测后发送通知
 *
 * 调用鉴权：config.checkToken（存于 KV，加密），通过环境变量 CHECK_TOKEN 兜底。
 */

import { parseRepoString, parseCnbRepoString, normalizeRepos, resolveSource, SOURCE_RELEASE } from '../lib/utils/index.js';
import {
  checkRepoUpdate,
  checkGiteeRepoUpdate,
  parseGiteeRepoString,
  checkGitLabRepoUpdate,
  parseGitLabRepoString,
  checkGitCodeRepoUpdate,
  parseGitCodeRepoString,
  checkGitCodeRelease,
  checkCnbBuildUpdate,
  checkCnbRelease,
  checkGitHubRelease,
  checkGiteeRelease,
  checkGitLabRelease,
  getRateLimitInfo,
  notify,
} from '../lib/services/index.js';
import { getConfig } from '../lib/config.js';

// 各平台对应的检测函数：commit 依据与 release 依据
const CHECKERS = {
  github: { commit: checkRepoUpdate, release: checkGitHubRelease },
  gitee: { commit: checkGiteeRepoUpdate, release: checkGiteeRelease },
  gitlab: { commit: checkGitLabRepoUpdate, release: checkGitLabRelease },
  gitcode: { commit: checkGitCodeRepoUpdate, release: checkGitCodeRelease },
  cnb: { commit: checkCnbBuildUpdate, release: checkCnbRelease },
};

/**
 * 按仓库配置的更新依据分发到对应检测函数
 * @param {'github'|'gitee'|'gitlab'|'gitcode'|'cnb'} platform
 * @param {Object} repoInfo 已规范化的仓库条目（含 source / includePrerelease）
 * @param {Object} config
 */
function checkBySource(platform, repoInfo, config) {
  const source = resolveSource(platform, repoInfo);
  const checker = CHECKERS[platform][source];
  return checker(repoInfo, config);
}

/**
 * 从已配置的仓库列表中查找同名条目，用于继承 source / includePrerelease。
 * 单仓库检测（?repo=）走 parseRepoString 解析，本身不带这两个字段。
 * @param {Array} repos 已规范化的仓库列表
 * @param {{owner: string, repo: string}} repoInfo
 * @returns {{source?: string, includePrerelease?: boolean}}
 */
function findRepoConfig(repos, repoInfo) {
  const hit = (repos || []).find(r => r.owner === repoInfo.owner && r.repo === repoInfo.repo);
  return hit ? { source: hit.source, includePrerelease: hit.includePrerelease } : {};
}

// 核心检测逻辑
// 导出供自托管 Node 部署的内置调度器复用（server/scheduler.js）。
// 服务端通过下方的 onRequestGet / onRequestPost 调用（由 server/router.js 分派）。
export async function performCheck(config, options = {}) {
  const { targetRepo, enableNotify = false, platform = 'all' } = options;

  let results = [];

  // GitHub 仓库检测
  if (platform === 'all' || platform === 'github') {
    const githubRepos = normalizeRepos(config.github?.repos, config.github?.branch || 'main');
    if (targetRepo && platform === 'github') {
      const repoInfo = parseRepoString(targetRepo, config.github?.branch || 'main');
      if (repoInfo) {
        results.push(await checkBySource('github', { ...repoInfo, ...findRepoConfig(githubRepos, repoInfo) }, config));
      } else {
        return { error: '仓库格式错误，正确格式：owner/repo 或 owner/repo@branch', status: 400 };
      }
    } else if (!targetRepo) {
      for (const repo of githubRepos) {
        results.push(await checkBySource('github', repo, config));
      }
    }
  }

  // Gitee 仓库检测
  if (platform === 'all' || platform === 'gitee') {
    const giteeRepos = normalizeRepos(config.gitee?.repos, config.gitee?.branch || 'master');
    if (giteeRepos.length) {
      if (targetRepo && platform === 'gitee') {
        const repoInfo = parseGiteeRepoString(targetRepo, config.gitee.branch || 'master');
        if (repoInfo) {
          results.push(await checkBySource('gitee', { ...repoInfo, ...findRepoConfig(giteeRepos, repoInfo) }, config));
        } else {
          return { error: 'Gitee 仓库格式错误', status: 400 };
        }
      } else if (!targetRepo) {
        for (const repo of giteeRepos) {
          results.push(await checkBySource('gitee', repo, config));
        }
      }
    }
  }

  // GitLab 仓库检测
  if (platform === 'all' || platform === 'gitlab') {
    const gitlabRepos = normalizeRepos(config.gitlab?.repos, config.gitlab?.branch || 'main');
    if (gitlabRepos.length) {
      if (targetRepo && platform === 'gitlab') {
        const repoInfo = parseGitLabRepoString(targetRepo, config.gitlab.branch || 'main');
        if (repoInfo) {
          results.push(await checkBySource('gitlab', { ...repoInfo, ...findRepoConfig(gitlabRepos, repoInfo) }, config));
        } else {
          return { error: 'GitLab 仓库格式错误', status: 400 };
        }
      } else if (!targetRepo) {
        for (const repo of gitlabRepos) {
          results.push(await checkBySource('gitlab', repo, config));
        }
      }
    }
  }

  // GitCode 仓库检测
  if (platform === 'all' || platform === 'gitcode') {
    const gitcodeRepos = normalizeRepos(config.gitcode?.repos, config.gitcode?.branch || 'main');
    if (gitcodeRepos.length) {
      if (targetRepo && platform === 'gitcode') {
        const repoInfo = parseGitCodeRepoString(targetRepo, config.gitcode.branch || 'main');
        if (repoInfo) {
          results.push(await checkBySource('gitcode', { ...repoInfo, ...findRepoConfig(gitcodeRepos, repoInfo) }, config));
        } else {
          return { error: 'GitCode 仓库格式错误', status: 400 };
        }
      } else if (!targetRepo) {
        for (const repo of gitcodeRepos) {
          results.push(await checkBySource('gitcode', repo, config));
        }
      }
    }
  }

  // CNB 仓库检测
  if (platform === 'all' || platform === 'cnb') {
    const cnbRepos = normalizeRepos(config.cnb?.repos, config.cnb.branch || 'main');
    if (cnbRepos.length) {
      if (targetRepo && platform === 'cnb') {
        const repoInfo = parseCnbRepoString(targetRepo, config.cnb.branch || 'main');
        if (repoInfo) {
          results.push(await checkBySource('cnb', { ...repoInfo, ...findRepoConfig(cnbRepos, repoInfo) }, config));
        } else {
          return { error: 'CNB 仓库格式错误', status: 400 };
        }
      } else if (!targetRepo) {
        for (const repo of cnbRepos) {
          results.push(await checkBySource('cnb', repo, config));
        }
      }
    }
  }

  // 如果启用通知，发送通知
  if (enableNotify) {
    for (const result of results) {
      if (result.hasUpdate || (result.isFirstCheck && config.notifyOnFirstCheck === true)) {
        await notify(result, config);
      }
    }
  }

  return { results };
}

/**
 * 定长比较字符串（timing-safe）。
 * 此处不引入 node:crypto（保持纯 JS 实现，便于测试与跨环境复用），
 * 故用不提前 return 的逐字节异或比较，避免按前缀长度泄露匹配进度。
 */
function timingSafeEqual(a, b) {
  const sa = String(a), sb = String(b);
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

/**
 * 验证访问令牌
 * 令牌来源优先级：KV 配置 config.checkToken > 环境变量 CHECK_TOKEN
 */
function verifyToken(request, config, url, env) {
  // 访问令牌来源优先级：KV 配置 > context.env > globalThis
  const token = config.checkToken || (env && (env.CHECK_TOKEN || env.check_token)) || globalThis.CHECK_TOKEN || globalThis.check_token;
  if (!token) {
    // fail-closed 语义不变（无人可用），但对调用方按「未授权」而非「服务器错误」返回，
    // 避免把服务端配置缺失暴露成 500。真正的配置问题写入日志供运维排查。
    console.error('[check] 未配置 CHECK_TOKEN，拒绝所有 /api/check 调用');
    return { error: '未授权', status: 401 };
  }

  const authHeader = request.headers.get('Authorization');
  let provided;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    provided = authHeader.slice(7).trim();
  } else {
    provided = url.searchParams.get('token');
  }

  if (!provided || !timingSafeEqual(provided, token)) {
    return { error: '访问令牌无效', status: 401 };
  }

  return null;
}

// GET 请求 - 手动检测
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const config = await getConfig(context.env);

  // 验证访问令牌
  const tokenError = verifyToken(request, config, url, context.env);
  if (tokenError) {
    return new Response(JSON.stringify({ code: tokenError.status, message: tokenError.error }), {
      status: tokenError.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  const targetRepo = url.searchParams.get('repo');
  const enableNotify = url.searchParams.get('notify') === 'true';
  const platform = url.searchParams.get('type') || 'all';

  try {
    const result = await performCheck(config, { targetRepo, enableNotify, platform });

    if (result.error) {
      return new Response(JSON.stringify({ code: 400, message: result.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    return new Response(JSON.stringify({
      code: 200,
      message: enableNotify ? '检测完成，通知已发送' : '检测完成',
      data: result.results,
      rateLimit: await getRateLimitInfo(config)
    }, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      code: 500,
      message: '检测失败',
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}

// POST 请求 - 定时任务触发
export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const config = await getConfig(context.env);

  // 验证访问令牌
  const tokenError = verifyToken(request, config, url, context.env);
  if (tokenError) {
    return new Response(JSON.stringify({
      code: tokenError.status,
      message: tokenError.error,
      executedAt: new Date().toISOString()
    }), {
      status: tokenError.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  let options = {};

  try {
    // 解析 JSON body（定时任务 payload）
    const body = await request.json().catch(() => ({}));
    options = {
      enableNotify: body.notify === true || body.notify === 'true',
      platform: body.type || 'all',
      targetRepo: body.repo || null
    };
  } catch {
    // 无 body 时使用默认值
    options = { enableNotify: false, platform: 'all', targetRepo: null };
  }

  try {
    const result = await performCheck(config, options);

    if (result.error) {
      return new Response(JSON.stringify({
        code: 400,
        message: result.error,
        executedAt: new Date().toISOString()
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    return new Response(JSON.stringify({
      code: 200,
      message: options.enableNotify ? '定时检测完成，通知已发送' : '定时检测完成',
      data: result.results,
      rateLimit: await getRateLimitInfo(config),
      executedAt: new Date().toISOString()
    }, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      code: 500,
      message: '定时检测失败',
      error: error.message,
      executedAt: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
