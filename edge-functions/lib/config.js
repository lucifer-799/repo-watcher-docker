/**
 * 配置层：统一从 KV 读写整体配置（repo_watcher_config）
 *
 * - getConfig()：读取配置，自动解密敏感字段，返回明文 config 对象（仅服务端使用）
 * - saveConfig(input)：合并后写回 KV，敏感字段加密存储
 * - getMaskedConfig()：返回脱敏后的配置（敏感字段用掩码），供管理后台展示
 */

import { kvGetJSON, kvPutJSON, kvUpdate } from './utils/kv.js';
import { encryptField, decryptField, isEncrypted, initEnv as initCryptoEnv } from './utils/crypto.js';

const CONFIG_KEY = 'config';

// 标记为「敏感」的字段（见计划文档第二节）
const SENSITIVE_PATHS = [
  'github.token',
  'gitee.token',
  'gitlab.token',
  'gitcode.token',
  'cnb.token',
  'checkToken',
  'magicpush.url',
  'magicpush.token',
  'custom.headers',
  'custom.body',
];

function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setByPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

function defaultConfig() {
  return {
    github: { repos: [], branch: 'main', token: '', proxy: '' },
    gitee: { repos: [], branch: 'master', token: '', proxy: '' },
    gitlab: { repos: [], branch: 'main', token: '', apiBase: 'https://gitlab.com', host: 'gitlab.com', proxy: '' },
    gitcode: { repos: [], branch: 'main', token: '', apiBase: 'https://gitcode.com', host: 'gitcode.com', proxy: '' },
    cnb: { repos: [], branch: 'main', token: '', apiBase: 'https://api.cnb.cool', proxy: '' },
    notifyOnFirstCheck: false,
    tz: 'UTC+8',
    checkToken: '',
    magicpush: { enabled: false, url: '', token: '' },
    custom: { enabled: false, url: '', method: 'POST', headers: '', body: '' },
    // 内置定时检测：仅自托管 Node 常驻进程可用（见 getCapabilities）。
    // Edge 部署无守常住进程，该字段被保存但无人消费，无副作用。
    scheduler: { enabled: false, intervalMinutes: 30 },
  };
}

/**
 * 归一化调度器配置：布尔化开关，间隔钳制到 [1, 1440] 分钟。
 * 非法/缺失值一律回落到默认，避免脏数据导致调度器死循环或永不触发。
 * @param {Object} [input]
 * @returns {{enabled: boolean, intervalMinutes: number}}
 */
// 调度默认间隔（分钟）。scheduler.js 与 normalizeScheduler 共用，避免两处硬编码漂移。
export const DEFAULT_INTERVAL_MINUTES = 30;

function normalizeScheduler(input) {
  const raw = (input && typeof input === 'object') ? input : {};
  const given = raw.intervalMinutes;
  // null / undefined / '' 视为「未提供」；注意 Number(null) 为 0，不能与显式 0 混为一谈，
  // 否则会把「未设置」误判成「间隔 0 分钟」并钳制成 1，导致调度器高频空转。
  const absent = given === null || given === undefined || given === '';
  const parsed = Number(given);
  const intervalMinutes = absent || !Number.isFinite(parsed)
    ? DEFAULT_INTERVAL_MINUTES
    : Math.min(1440, Math.max(1, Math.trunc(parsed)));
  return { enabled: raw.enabled === true, intervalMinutes };
}

/**
 * 返回运行时能力位，供管理后台据此决定是否展示仅常驻进程可用的功能。
 * 判定依据：context.env.RUNTIME === 'node'（由自托管 Node 服务启动时注入）。
 *
 * @param {Object} [env]
 * @returns {{runtime: 'node'|'edge', scheduler: boolean}}
 */
export function getCapabilities(env) {
  const e = env || globalThis;
  const isNode =
    (e && (e.RUNTIME === 'node' || e.runtime === 'node')) ||
    globalThis.RUNTIME === 'node';
  return {
    runtime: isNode ? 'node' : 'edge',
    // 内置定时检测依赖常驻进程；Edge 部署需外部 Cron 触发 /api/check
    scheduler: isNode,
  };
}

/**
 * 读取配置并解密敏感字段
 * @returns {Promise<Object>} 明文配置
 */
export async function getConfig(env) {
  if (env) initCryptoEnv(env);
  const stored = await kvGetJSON(CONFIG_KEY);
  const config = { ...defaultConfig(), ...(stored || {}) };

  for (const path of SENSITIVE_PATHS) {
    const val = getByPath(config, path);
    if (val && isEncrypted(val)) {
      setByPath(config, path, await decryptField(val));
    }
  }
  return config;
}

/**
 * 合并并保存配置（加密敏感字段）
 * @param {Object} input 用户提交的部分/整体配置
 * @returns {Promise<Object>} 保存后的明文配置
 */
export async function saveConfig(input, env) {
  if (env) initCryptoEnv(env);
  // 原子读-改-写（CAS）：在同一事务内重新读取最新配置再合并写回，
  // 避免两台机器/两个标签页同时保存时后写者覆盖前者（并发丢更新）。
  return kvUpdate(CONFIG_KEY, async () => {
  const current = await getConfig(env);
  const merged = deepMerge(current, input || {});

  // 清理：移除已废弃的旧版 repo 字符串字段（仅保留结构化 repos 数组）
  for (const k of ['github', 'gitee', 'gitlab', 'gitcode', 'cnb']) {
    if (merged[k] && 'repo' in merged[k]) {
      delete merged[k].repo;
    }
  }

  // 调度器为可信度低的普通字段（非敏感，可被 UI 直接编辑），落库前统一归一化
  merged.scheduler = normalizeScheduler(merged.scheduler);

  // 加密敏感字段
  for (const path of SENSITIVE_PATHS) {
    const val = getByPath(merged, path);
    if (val === '' || val == null) {
      // 空值表示不修改，保留原存储值：从已读 current 拷回
      const original = getByPath(current, path);
      if (original) {
        setByPath(merged, path, isEncrypted(original) ? original : await encryptField(original));
      } else {
        setByPath(merged, path, '');
      }
      continue;
    }
    if (!isEncrypted(val)) {
      setByPath(merged, path, await encryptField(val));
    }
  }

  // 事务内直接返回合并结果，由 kvUpdate 负责落库
  return merged;
  });
}

/**
 * 返回安全配置：敏感字段一律置空，绝不回传任何明文或脱敏字符
 */
export async function getMaskedConfig(env) {
  const config = await getConfig(env);
  const blanked = JSON.parse(JSON.stringify(config));
  for (const path of SENSITIVE_PATHS) {
    const val = getByPath(blanked, path);
    if (val) setByPath(blanked, path, '');
  }
  return blanked;
}

/**
 * 返回敏感字段是否已配置的状态（仅布尔，不含任何密钥信息）
 */
export async function getSecretStatus(env) {
  const config = await getConfig(env);
  const status = {};
  for (const path of SENSITIVE_PATHS) {
    const val = getByPath(config, path);
    const keys = path.split('.');
    if (keys.length === 2) {
      status[keys[0]] = status[keys[0]] || {};
      status[keys[0]][keys[1]] = !!val;
    } else {
      status[keys[0]] = !!val;
    }
  }
  return status;
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override !== undefined ? override : base;
  }
  if (typeof base === 'object' && base !== null && typeof override === 'object' && override !== null) {
    const out = { ...base };
    for (const k of Object.keys(override)) {
      out[k] = deepMerge(base[k], override[k]);
    }
    return out;
  }
  return override !== undefined ? override : base;
}
