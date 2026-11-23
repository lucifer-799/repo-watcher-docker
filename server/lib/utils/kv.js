/**
 * KV 存储操作工具（Docker / Node 版）
 *
 * 本项目只支持自托管 Node/Docker 运行时：服务启动时由 server/index.js 通过
 * setStorageDriver() 注入 SQLite 驱动（server/storage/sqlite.js）。
 * **不内置任何 Edge / EdgeOne KV 支持**（已随 1.1.2 精简删除）。
 *
 * ---- 存储驱动抽象 ----
 * 本文件是全项目唯一的存储耦合点。对外暴露的函数（kvGet / kvGetJSON / kvPut /
 * kvPutJSON / kvDelete / kvList / getRepoData / saveRepoData / kvUpdate / kvPutIfAbsent）
 * 签名与语义保持不变，内部转发给当前激活的存储驱动：
 *
 *   - 唯一驱动：自托管 Node 常驻进程启动时注入的 SQLite 实现。
 *   - 未注入时所有存储操作直接抛错（fail-closed，避免静默丢数据）。
 *
 * 驱动契约（所有方法接收的 key 均已带 repo_watcher_ 前缀）：
 *   get(fullKey)                       -> Promise<string | null>      缺失返回 null
 *   getJSON(fullKey)                   -> Promise<object | null>      缺失返回 null（可选实现）
 *   put(fullKey, value)                -> Promise<void>               value 为字符串
 *   delete(fullKey)                    -> Promise<void>
 *   list(fullPrefix, cursor, limit)    -> Promise<{ keys: [{name}], cursor?, complete }>
 *   deletePrefix(fullPrefix)           -> Promise<number>             删除条数（可选实现）
 *
 * 说明：SQLite 驱动实现放在 server/storage/sqlite.js，由 server/index.js 注入本模块；
 * 本文件自身不 import 任何 Node 内置模块（便于用内存驱动做单元测试）。
 */

// 所有 KV 存储键统一加上的前缀
const KV_KEY_PREFIX = 'repo_watcher_';

// ---- 驱动注册 ----

// 当前激活的驱动。必须由 server/index.js 在启动时注入 SQLite 驱动；
// 未注入时为 null，所有存储操作抛错（fail-closed，避免静默丢数据）。
let activeDriver = null;

/**
 * 注册存储驱动（server/index.js 启动时注入 SQLite 实现）。
 *
 * 注意：驱动一旦注册即对本进程全局生效，无法回退——
 * 避免运行期出现「一半请求走某个驱动、一半走另一个」的数据分裂。
 *
 * @param {Object} driver 存储驱动，至少需实现 get() 与 put()
 */
export function setStorageDriver(driver) {
  if (!driver || typeof driver.get !== 'function' || typeof driver.put !== 'function') {
    throw new Error('存储驱动不合法：至少需实现 get() 与 put()');
  }
  activeDriver = driver;
}

/**
 * 获取当前激活的驱动（供测试与调试使用）
 * @returns {Object}
 */
export function getStorageDriver() {
  return activeDriver;
}

function getDriver() {
  if (!activeDriver) {
    // 未注入驱动：直接报错，而不是静默失败（fail-closed）
    throw new Error('存储驱动未初始化：请先调用 setStorageDriver() 注入 SQLite 驱动');
  }
  return activeDriver;
}

function withPrefix(key) {
  return `${KV_KEY_PREFIX}${key}`;
}

export async function kvGet(key) {
  return getDriver().get(withPrefix(key));
}

export async function kvGetJSON(key) {
  const driver = getDriver();
  // getJSON 为可选实现：未实现时由本层读回字符串后解析，保证契约一致
  if (typeof driver.getJSON === 'function') {
    return driver.getJSON(withPrefix(key));
  }
  const raw = await driver.get(withPrefix(key));
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return JSON.parse(raw);
  return raw;
}

export async function kvPut(key, value) {
  return getDriver().put(withPrefix(key), value);
}

export async function kvPutJSON(key, value) {
  return getDriver().put(withPrefix(key), JSON.stringify(value));
}

export async function kvDelete(key) {
  return getDriver().delete(withPrefix(key));
}

/**
 * 仅当 key 不存在时写入（原子 CAS，用于消除「检查-写入」竞态）。
 * 驱动实现 putIfAbsent 时使用数据库级原子语义；否则退化为「读-判-写」（非严格原子，
 * 本项目的 SQLite 驱动为真原子（唯一约束）。
 * @returns {Promise<boolean>} true=写入成功，false=已存在（未覆盖）
 */
export async function kvPutIfAbsent(key, value) {
  const driver = getDriver();
  const full = withPrefix(key);
  if (typeof driver.putIfAbsent === 'function') {
    return driver.putIfAbsent(full, value);
  }
  const existing = await driver.get(full);
  if (existing !== null && existing !== undefined) return false;
  await driver.put(full, value);
  return true;
}

/**
 * 原子的「读-改-写」（消除并发丢更新）。
 * 驱动实现 update 时在单事务内完成；否则退化为普通读-改-写。
 * @param {string} key 原始 key
 * @param {(current: any) => any} updater 接收当前值（JSON 或 null），返回新值
 * @returns {Promise<any>} 写入后的值
 */
export async function kvUpdate(key, updater) {
  const driver = getDriver();
  const full = withPrefix(key);
  const parse = (raw) => {
    if (raw === null || raw === undefined) return null;
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  };
  // 值序列化：字符串视为「已是 JSON 文本」直接落库（供乐观锁场景原样回写他人版本），
  // 其余类型按 JSON.stringify。避免之前把字符串再 stringify 一次导致双重编码。
  const serialize = (v) => {
    if (v === null || v === undefined) return null;
    return typeof v === 'string' ? v : JSON.stringify(v);
  };

  if (typeof driver.update === 'function') {
    // 事务内「读-改-写」：**updater 应保持同步且轻量**，避免长事务持锁
    // （sqlite 驱动的 BEGIN IMMEDIATE 期间持写锁）。异步加密请在调用前完成。
    return parse(await driver.update(full, (raw) => serialize(updater(parse(raw)))));
  }
  const current = parse(await driver.get(full));
  const next = await updater(current);
  const str = serialize(next);
  if (str === null) await driver.delete(full);
  else await driver.put(full, str);
  return next;
}

/**
 * 列举指定前缀的 key（自动处理分页）。
 * 返回的 key 为「原始 key」（不含 KV_KEY_PREFIX），可直接传给 kvDelete/kvGet 复用。
 * @param {string} prefix 原始前缀，如 'session:'
 * @returns {Promise<string[]>}
 */
export async function kvList(prefix) {
  const driver = getDriver();
  const full = withPrefix(prefix);
  const out = [];
  let cursor;
  let complete = false;
  do {
    const result = await driver.list(full, cursor, 1000);
    for (const k of result.keys || []) {
      // 只接受带本前缀的 key；否则带上前缀原样返回会让调用方再拼一次前缀
      // （如 kvDelete(repo_watcher_xxx) → repo_watcher_repo_watcher_xxx），导致删不掉。
      if (!k.name.startsWith(full)) continue;
      const bare = k.name.slice(full.length);
      if (!bare) continue; // 恰好等于前缀本身，跳过
      out.push(bare);
    }
    cursor = result.cursor;
    // 驱动未返回 complete 字段时按「单页取完」处理，避免无限循环
    complete = result.complete !== false;
  } while (!complete);
  return out;
}

/**
 * 批量删除指定前缀下的所有 key。
 *
 * 默认 KV 驱动无批量删除能力，退化为 list + 逐条 delete；
 * SQLite 等本地驱动可实现 deletePrefix 用单条语句完成，
 * 用于替换 deleteAllSessions() 原先的 N 次网络往返。
 *
 * @param {string} prefix 原始前缀，如 'session:'
 * @returns {Promise<number>} 删除条数
 */
export async function kvDeletePrefix(prefix) {
  const driver = getDriver();
  const full = withPrefix(prefix);
  if (typeof driver.deletePrefix === 'function') {
    return driver.deletePrefix(full);
  }
  // 兜底路径：kvList 返回的是「已剥离 repo_watcher_ 前缀」的原始 key，
  // 必须先还原成完整 key 再交给驱动删除，否则会误删成 repo_watcher_<短key>。
  const keys = await kvList(prefix);
  await Promise.all(keys.map((k) => driver.delete(k.startsWith(full) ? k : full + k)));
  return keys.length;
}

/**
 * 从KV读取仓库数据（兼容旧格式）
 * @param {string} key 存储键
 * @param {string} [platform] 平台类型，仅为保持调用兼容而保留
 * @returns {Promise<Object|null>} 解析后的数据对象
 */
export async function getRepoData(key) {
  let data = await kvGet(key);

  // 兼容历史数据：旧版本此处误叠加了两次前缀，
  // 数据实际落在 repo_watcher_repo_watcher_<key> 上，此处回读一次。
  if (!data) {
    data = await kvGet(withPrefix(key)).catch(() => null);
  }

  if (!data) return null;

  // 数据已经是 JSON 对象，无需再次解析
  // 兼容旧格式: 如果 data 是字符串，尝试解析
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      // 旧格式兼容：纯字符串视为上一次记录的提交 SHA
      return { sha: data, updatedAt: null };
    }
  }

  return data;
}

/**
 * 保存仓库数据到KV
 *
 * 语义约定：
 *   - updatedAt     数据最后一次「发生变化」的时间（即 SHA 变更），无变化时保持不变
 *   - lastCheckedAt 最后一次「执行检测」的时间，每次检测都会刷新，用于判断检测任务是否存活
 *
 * @param {string} key 存储键
 * @param {Object} data 本次要写入的数据
 * @param {Object} [options]
 * @param {boolean} [options.changed=true]
 *   true（默认）：数据发生变化，覆盖提交快照并刷新 updatedAt；
 *   false：仅刷新检测元数据（lastCheckedAt / lastCheckStatus / lastCheckError），
 *          会先读回既有记录做合并，避免丢失已保存的 sha 与 updatedAt。
 * @returns {Promise<Object>}
 */
export async function saveRepoData(key, data, options = {}) {
  const { changed = true } = options;

  // 原子「读-改-写」：多个检测任务并发写同一 key 时不会互相覆盖导致丢更新。
  return kvUpdate(key, (current) => {
    const now = new Date().toISOString();
    // changed=false 时保留既有 sha/updatedAt，仅刷新检测元数据
    const base = (!changed && current && typeof current === 'object') ? current : {};
    return {
      ...base,
      ...data,
      lastCheckedAt: now,
      ...(changed ? { updatedAt: now } : {})
    };
  });
}
