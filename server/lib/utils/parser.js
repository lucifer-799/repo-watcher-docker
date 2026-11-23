/**
 * 解析单个仓库字符串（格式：owner/repo 或 owner/repo@branch）
 * @param {string} repoStr 单个仓库字符串
 * @param {string} defaultBranch 默认分支
 * @returns {{owner: string, repo: string, branch: string}|null}
 */
export function parseRepoString(repoStr, defaultBranch) {
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
 * 解析单个 CNB 仓库字符串（格式：owner/repo 或 owner/repo@branch）
 * @param {string} repoStr 单个 CNB 仓库字符串
 * @param {string} defaultBranch 默认分支
 * @returns {{owner: string, repo: string, branch: string}|null}
 */
export function parseCnbRepoString(repoStr, defaultBranch) {
  const parts = repoStr.split('@');
  const repoParts = parts[0].split('/');

  if (repoParts.length !== 2) return null;

  return {
    owner: repoParts[0].trim(),
    repo: repoParts[1].trim(),
    branch: parts.length > 1 ? parts[1].trim() : defaultBranch
  };
}

// 更新依据的合法取值
export const SOURCE_COMMIT = 'commit';
export const SOURCE_RELEASE = 'release';

/**
 * 解析仓库条目的更新依据（服务端唯一可信来源）
 *
 * 仅当显式配置为 'release' 时启用 release 检测，其余值（含脏值）一律回落 commit。
 * CNB 已提供 /-/releases Open API，故与其它平台一致支持 release 依据。
 *
 * @param {'github'|'gitee'|'gitlab'|'gitcode'|'cnb'} platform 平台标识
 * @param {{source?: string}} repoItem 已规范化的仓库条目
 * @returns {'commit'|'release'}
 */
export function resolveSource(platform, repoItem) {
  return repoItem?.source === SOURCE_RELEASE ? SOURCE_RELEASE : SOURCE_COMMIT;
}

/**
 * 计算仓库状态在 KV 中的存储键（唯一来源，检测与读取两侧必须共用）
 *
 * Release 属仓库级资源、不绑定分支，故其键不带分支名，
 * 且与 commit 键区分，避免切换检测依据时串味。
 *
 * @param {'github'|'gitee'|'gitlab'|'gitcode'|'cnb'} platform
 * @param {{owner: string, repo: string, branch: string}} repoItem
 * @param {'commit'|'release'} source
 * @returns {string}
 */
export function buildRepoDataKey(platform, repoItem, source) {
  const { owner, repo, branch } = repoItem;
  if (source === SOURCE_RELEASE) {
    return `${platform}:${owner}/${repo}@release`;
  }
  // 历史约定：GitHub 的 commit 键不带平台前缀，保持兼容以免既有数据失联
  const prefix = platform === 'github' ? '' : `${platform}:`;
  return `${prefix}${owner}/${repo}@${branch}`;
}

/**
 * 将单个仓库条目（结构化或字符串）解析为标准化对象
 * @param {string|Object} item 仓库条目，字符串如 "owner/repo@branch"，或对象 {repo, branch, note, source, includePrerelease}
 * @param {string} defaultBranch 默认分支
 * @returns {{owner: string, repo: string, branch: string, note: string, source: string, includePrerelease: boolean}|null}
 */
function normalizeEntry(item, defaultBranch) {
  let str, note = '', source = SOURCE_COMMIT, includePrerelease = false;
  if (typeof item === 'string') {
    str = item.trim();
  } else if (item && typeof item === 'object') {
    str = (item.repo || '').trim();
    note = (item.note || '').trim();
    if (item.branch && (!str.includes('@'))) {
      str = `${str}@${item.branch}`;
    }
    // source 属不可信输入，做白名单校验，非法值归一为 commit
    source = item.source === SOURCE_RELEASE ? SOURCE_RELEASE : SOURCE_COMMIT;
    includePrerelease = item.includePrerelease === true;
  } else {
    return null;
  }
  if (!str) return null;

  const result = parseRepoString(str, defaultBranch);
  if (!result) return null;
  result.note = note;
  result.source = source;
  result.includePrerelease = includePrerelease;
  return result;
}

/**
 * 规范化仓库列表（兼容旧版字符串与新版结构化数组）
 * 新版数组格式：[{ repo: 'owner/repo', branch: 'main', note: '备注' }]
 * 旧版字符串格式：'owner/repo@branch, owner2/repo2'
 * @param {string|Array|undefined} input 仓库数据
 * @param {string} defaultBranch 默认分支
 * @returns {Array<{owner: string, repo: string, branch: string, note: string, source: string, includePrerelease: boolean}>}
 */
export function normalizeRepos(input, defaultBranch) {
  if (!input) return [];

  let items;
  if (Array.isArray(input)) {
    items = input;
  } else if (typeof input === 'string') {
    const delimiter = input.includes('\n') ? '\n' : ',';
    items = input.split(delimiter).map(s => s.trim()).filter(Boolean);
  } else {
    return [];
  }

  return items
    .map(item => normalizeEntry(item, defaultBranch))
    .filter(Boolean);
}
