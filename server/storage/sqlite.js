/**
 * SQLite 存储驱动（node:sqlite，零依赖）
 *
 * 用单表 kv_store 1:1 复刻 EdgeOne KV 语义，供 edge-functions/lib/utils/kv.js 的
 * setStorageDriver() 注入。驱动接收的 key 均已带 repo_watcher_ 前缀。
 *
 * ---- node:sqlite 版本约束（已核对官方文档 History 表）----
 * 目标运行时为 Node v22（容器镜像 node:22-slim），实现必须遵守：
 *   1. statement.get() 无匹配行时返回 undefined，而契约要求 null → 必须显式转换。
 *   2. statement.close() 直到 v26.8.0 才加入，22.18.0 调用会抛 TypeError → 绝不调用。
 *   3. new DatabaseSync(path, { timeout }) 的 timeout 选项自 v22.16.0 起可用 → 可用。
 *   4. 无需 --experimental-sqlite 标志（v22.13.0 起免标志）。
 * 相关 API 若需升级到更高 Node 版本，须重新核对上述条目。
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 创建并初始化 SQLite 存储驱动。
 *
 * @param {string} dbPath 数据库文件路径。传 ':memory:' 可用于测试。
 * @returns {Object} 符合存储驱动契约的对象（含可选的 getJSON / deletePrefix）
 */
export function createSqliteDriver(dbPath) {
  if (!dbPath) {
    throw new Error('sqlite 驱动缺少数据库路径');
  }

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath, { timeout: 5000 });

  // WAL 让读不阻塞写；NORMAL 在性能与崩溃安全间取平衡（本项目数据量极小）。
  // 注意：journal_mode 是持久属性，只需首次设置，重复执行无副作用。
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS kv_store (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // 预编译语句。DatabaseSync 为同步 API，复用 prepared statement 可避免重复编译开销。
  // 注意：不要调用 stmt.close() —— 该方法 v26.8.0 才加入，22.18.0 会抛 TypeError。
  // LIKE 必须带 ESCAPE '\' 子句，escapeLike() 插入的反斜杠才会被当作转义符；
  // 缺少该子句时反斜杠是普通字符，反而会让转义后的字面量匹配失败。
  const stmtGet = db.prepare('SELECT value FROM kv_store WHERE key = ?');
  const stmtPut = db.prepare(`
    INSERT INTO kv_store (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  // 仅插入（不带 ON CONFLICT）：key 已存在时触发 UNIQUE 约束错误 → 供 putIfAbsent 做原子 CAS
  const stmtInsert = db.prepare(
    "INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  );
  const stmtDelete = db.prepare('DELETE FROM kv_store WHERE key = ?');
  const stmtList = db.prepare(
    "SELECT key FROM kv_store WHERE key LIKE ? ESCAPE '\\' COLLATE BINARY ORDER BY key"
  );
  const stmtDeletePrefix = db.prepare(
    "DELETE FROM kv_store WHERE key LIKE ? ESCAPE '\\' COLLATE BINARY"
  );

  return {
    /**
     * 注意：LIKE 的 % _ 是通配符，前缀需转义后再拼接，
     * 否则含下划线/百分号的 key 会错误匹配到无关记录。
     */
    async get(fullKey) {
      const row = stmtGet.get(fullKey);
      // get() 无行时返回 undefined，契约要求 null
      return row === undefined ? null : row.value;
    },

    async getJSON(fullKey) {
      const row = stmtGet.get(fullKey);
      if (row === undefined) return null;
      // 存储值损坏时不应让整条请求 500，按「无数据」处理并记录
      try {
        return JSON.parse(row.value);
      } catch (e) {
        console.error('[sqlite] kv_store JSON 解析失败 key=%s: %s', fullKey, e && e.message);
        return null;
      }
    },

    async put(fullKey, value) {
      stmtPut.run(fullKey, String(value));
    },

    async delete(fullKey) {
      stmtDelete.run(fullKey);
    },

    /**
     * 原子「仅当不存在时写入」：依赖 kv_store.key 的 PRIMARY KEY 唯一约束。
     * 并发下只有一个 INSERT 会成功，其余抛 UNIQUE 错误 → 返回 false。
     */
    async putIfAbsent(fullKey, value) {
      try {
        stmtInsert.run(fullKey, String(value));
        return true;
      } catch (e) {
        if (/UNIQUE|constraint/i.test(String(e && e.message))) return false;
        throw e;
      }
    },

    /**
     * 原子「读-改-写」：BEGIN IMMEDIATE 立即取写锁，读到写期间不会被其它连接插队，
     * 从根本上消除并发丢更新（CAS 语义）。
     */
    async update(fullKey, updater) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = stmtGet.get(fullKey);
        // 允许 async updater（如配置项加密）：BEGIN IMMEDIATE 期间持写锁，保持事务语义。
        const next = await updater(row === undefined ? null : row.value);
        if (next === null || next === undefined) stmtDelete.run(fullKey);
        else stmtPut.run(fullKey, String(next));
        db.exec('COMMIT');
        return next;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* 忽略回滚失败 */ }
        throw e;
      }
    },

    async list(fullPrefix) {
      // 本地驱动无分页：一次返回全部，恒 complete
      const rows = stmtList.all(escapeLike(fullPrefix) + '%');
      return {
        keys: rows.map((r) => ({ name: r.key })),
        complete: true,
      };
    },

    async deletePrefix(fullPrefix) {
      const result = stmtDeletePrefix.run(escapeLike(fullPrefix) + '%');
      return Number(result.changes);
    },

    /** 关闭数据库连接（进程退出时调用） */
    close() {
      try {
        db.close();
      } catch {
        // 已关闭或处于不可关闭状态时忽略
      }
    },
  };
}

/**
 * 转义 LIKE 通配符，使前缀按字面量匹配。
 * 现有 key 形如 repo_watcher_session:<jti>，jti 为 base64url（不含 % _），
 * 但仓库 key 含用户可控字符，必须防御。
 * @param {string} str
 * @returns {string}
 */
function escapeLike(str) {
  return String(str).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
