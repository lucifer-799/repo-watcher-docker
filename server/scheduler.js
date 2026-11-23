/**
 * 内置定时检测调度器（仅自托管 Node 常驻进程可用）
 *
 * 设计：60 秒心跳 + 配置驱动，而非固定 setInterval。
 * 固定间隔无法响应管理后台的间隔变更（须重启进程）；心跳方案每次 tick 读取最新
 * 配置自行判断是否到点，配置保存后最迟 60 秒生效。
 *
 * 进程内直接调用 performCheck，绕过 /api/check 的 verifyToken ——
 * 该接口未配置 token 会返回 500，而调度器是内部调用，无需也不应走 HTTP 鉴权。
 */

import { getConfig, DEFAULT_INTERVAL_MINUTES } from './lib/config.js';
import { performCheck } from './api/check.js';

// 心跳间隔。也是配置变更的最迟生效时间。
const TICK_MS = 60 * 1000;

let timer = null;
let running = false;
let lastRunAt = 0;
let lastError = null;
let lastResult = null;

/**
 * 启动调度器。重复调用无副作用。
 * @param {{ env?: Object }} [options]
 */
export function startScheduler(options = {}) {
  if (timer) return;
  const env = options.env || process.env;

  timer = setInterval(() => {
    tick(env).catch((err) => {
      // tick 内部已捕获业务异常，这里仅兜底
      console.error('[scheduler] 心跳异常:', err);
    });
  }, TICK_MS);
  timer.unref?.();

  // 启动后延迟一个心跳再执行首次检测，避免与进程启动期的数据库初始化竞争
  console.log('[scheduler] 已启动，心跳间隔 60s');
}

/** 停止调度器。重复调用无副作用。 */
export function stopScheduler() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  console.log('[scheduler] 已停止');
}

async function tick(env) {
  // 重入保护：必须在任何 await 之前「同步」置位，
  // 否则 await getConfig 期间到达的并发心跳会看到 running=false 而双重执行。
  if (running) {
    console.warn('[scheduler] 上一轮检测尚未结束，跳过本次心跳');
    return;
  }
  running = true;
  const startedAt = Date.now();

  try {
    let config;
    try {
      config = await getConfig(env);
    } catch (err) {
      // 配置读取失败（如 CONFIG_ENC_KEY 缺失）不应让进程崩溃
      lastError = err.message;
      console.error('[scheduler] 读取配置失败:', err.message);
      return;
    }

    const scheduler = config.scheduler || { enabled: false, intervalMinutes: DEFAULT_INTERVAL_MINUTES };
    if (!scheduler.enabled) return;

    const intervalMs = Math.max(1, Number(scheduler.intervalMinutes) || DEFAULT_INTERVAL_MINUTES) * 60 * 1000;
    const now = Date.now();
    if (lastRunAt && now - lastRunAt < intervalMs) return;

    const { results } = await performCheck(config, {
      enableNotify: true,
      platform: 'all',
    });
    lastRunAt = Date.now();
    lastError = null;
    const updated = (results || []).filter((r) => r.hasUpdate).length;
    lastResult = { total: (results || []).length, updated, at: new Date().toISOString() };
    console.log(`[scheduler] 检测完成：${updated}/${lastResult.total} 个仓库有更新`);
  } catch (err) {
    lastError = err.message;
    console.error('[scheduler] 检测失败:', err.message);
  } finally {
    running = false;
    const cost = Date.now() - startedAt;
    if (cost > 30000) {
      console.warn(`[scheduler] 本轮检测耗时 ${cost}ms，建议增大检测间隔`);
    }
  }
}

/**
 * 暴露调度器状态（可用于后续接入健康检查或管理后台展示）。
 * @returns {{ enabled: boolean, running: boolean, lastRunAt: number|null, lastError: string|null, lastResult: Object|null }}
 */
export function getSchedulerStatus() {
  return {
    enabled: timer !== null,
    running,
    lastRunAt: lastRunAt || null,
    lastError,
    lastResult,
  };
}
