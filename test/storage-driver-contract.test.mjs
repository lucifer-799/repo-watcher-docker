/**
 * 存储驱动契约测试
 *
 * 用同一套断言验证「可注入门面」：
 *   1. 内存模拟驱动（验证门面语义与分页/前缀等边界）
 *   2. 真实 SQLite 驱动（server/storage/sqlite.js，node:sqlite）
 *
 * 说明：Edge/EdgeOne KV 默认驱动已随 1.1.2 精简删除，相关 mock 与契约不再适用。
 *
 * 运行：node scripts/storage-driver-contract.test.mjs
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---- 测试脚手架 ----

let passed = 0;
let failed = 0;

function it(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed += 1;
      console.error(`  ✗ ${name}\n      ${err.message}`);
    });
}

// ---- 内存 KV mock（模拟一个已注入的驱动，用于验证门面语义）----

function createMockKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key, type) {
      if (!store.has(key)) return null;
      const raw = store.get(key);
      if (type === 'json') return JSON.parse(raw);
      return raw;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      // 模拟分页：每页最多 2 条，用于验证 kvList 的游标循环
      const pageSize = Math.max(1, Math.min(limit, 2));
      const offset = cursor ? Number(cursor) : 0;
      const page = all.slice(offset, offset + pageSize);
      const nextOffset = offset + page.length;
      return {
        keys: page.map((name) => ({ name })),
        cursor: String(nextOffset),
        complete: nextOffset >= all.length,
      };
    },
  };
}

// ---- 内存自定义驱动（模拟自托管 SQLite 驱动，实现可选方法 deletePrefix）----

function createFakeLocalDriver() {
  const store = new Map();
  return {
    store,
    async get(fullKey) {
      return store.has(fullKey) ? store.get(fullKey) : null;
    },
    async getJSON(fullKey) {
      return store.has(fullKey) ? JSON.parse(store.get(fullKey)) : null;
    },
    async put(fullKey, value) {
      store.set(fullKey, String(value));
    },
    async delete(fullKey) {
      store.delete(fullKey);
    },
    async list(fullPrefix) {
      // 本地驱动无分页：一次返回全部
      return {
        keys: [...store.keys()]
          .filter((k) => k.startsWith(fullPrefix))
          .sort()
          .map((name) => ({ name })),
        complete: true,
      };
    },
    async deletePrefix(fullPrefix) {
      let n = 0;
      for (const k of [...store.keys()]) {
        if (k.startsWith(fullPrefix)) {
          store.delete(k);
          n += 1;
        }
      }
      return n;
    },
  };
}

// ---- 契约断言（两种驱动共用同一份）----

async function runContractSuite(label, driver, kvModule) {
  const {
    kvGet, kvGetJSON, kvPut, kvPutJSON, kvDelete, kvList, kvDeletePrefix,
    getRepoData, saveRepoData, setStorageDriver,
  } = kvModule;

  if (driver) setStorageDriver(driver);

  console.log(`\n[${label}]`);

  await it('kvGet 缺失键返回 null（而非 undefined）', async () => {
    const v = await kvGet('nope');
    assert.equal(v, null, '缺失键必须返回 null，getRepoData 依赖 if (!data) 判空');
  });

  await it('kvGetJSON 缺失键返回 null', async () => {
    assert.equal(await kvGetJSON('nope'), null);
  });

  await it('kvPut / kvGet 往返：写入后原样读回', async () => {
    await kvPut('plain', 'hello');
    assert.equal(await kvGet('plain'), 'hello');
  });

  await it('kvPutJSON / kvGetJSON 往返：JSON 序列化与反序列化', async () => {
    await kvPutJSON('obj', { a: 1, b: 'x' });
    assert.deepEqual(await kvGetJSON('obj'), { a: 1, b: 'x' });
  });

  await it('kvPutJSON 写入的值可被 kvGet 以字符串读回', async () => {
    await kvPutJSON('obj2', { a: 1 });
    assert.equal(await kvGet('obj2'), '{"a":1}');
  });

  await it('kvDelete 删除后读回 null', async () => {
    await kvPut('del', 'v');
    await kvDelete('del');
    assert.equal(await kvGet('del'), null);
  });

  await it('kvList 返回的 key 已剥离 repo_watcher_ 前缀', async () => {
    await kvPut('session:a', '1');
    await kvPut('session:b', '2');
    await kvPut('session:c', '3');
    await kvPut('other', 'x');
    const keys = await kvList('session:');
    assert.deepEqual(keys.sort(), ['a', 'b', 'c']);
  });

  await it('kvList 自动翻页（驱动每页仅返回 2 条）', async () => {
    // 上一条用例已写入 3 条 session，分页驱动需循环多页才能取完
    const keys = await kvList('session:');
    assert.equal(keys.length, 3, '分页未取完，说明游标循环有问题');
  });

  await it('kvDeletePrefix 批量删除并返回条数', async () => {
    const n = await kvDeletePrefix('session:');
    assert.equal(n, 3);
    assert.deepEqual(await kvList('session:'), []);
    assert.equal(await kvGet('other'), 'x', '不应误删前缀外的键');
  });

  await it('getRepoData 读取结构化 JSON', async () => {
    await kvPut('repo:gh:a', JSON.stringify({ sha: 'abc', updatedAt: 't1' }));
    const data = await getRepoData('repo:gh:a');
    assert.deepEqual(data, { sha: 'abc', updatedAt: 't1' });
  });

  await it('getRepoData 兼容旧格式：纯字符串视为 sha', async () => {
    await kvPut('repo:old', 'deadbeef');
    assert.deepEqual(await getRepoData('repo:old'), { sha: 'deadbeef', updatedAt: null });
  });

  await it('getRepoData 兼容历史双前缀数据', async () => {
    // 旧版本误叠加两次前缀：数据落在 repo_watcher_repo_watcher_<key>
    await kvPut('repo_watcher_repo:legacy', JSON.stringify({ sha: 'legacy' }));
    assert.deepEqual(await getRepoData('repo:legacy'), { sha: 'legacy' });
  });

  await it('saveRepoData(changed=true) 覆盖快照并刷新 updatedAt', async () => {
    const saved = await saveRepoData('repo:s1', { sha: 'v1' });
    assert.equal(saved.sha, 'v1');
    assert.ok(saved.updatedAt, 'changed=true 必须写入 updatedAt');
    assert.ok(saved.lastCheckedAt);
  });

  await it('saveRepoData(changed=false) 保留 sha/updatedAt，仅刷新检测元数据', async () => {
    const first = await saveRepoData('repo:s2', { sha: 'v1' });
    await new Promise((r) => setTimeout(r, 10));
    const second = await saveRepoData(
      'repo:s2',
      { lastCheckStatus: 'ok' },
      { changed: false }
    );
    assert.equal(second.sha, 'v1', '未变更时不得丢失已保存的 sha');
    assert.equal(second.updatedAt, first.updatedAt, '未变更时 updatedAt 必须保持不变');
    assert.equal(second.lastCheckStatus, 'ok');
    assert.ok(new Date(second.lastCheckedAt) >= new Date(first.lastCheckedAt));
  });

  await it('setStorageDriver 拒绝不合法的驱动', async () => {
    assert.throws(() => setStorageDriver({}), /存储驱动不合法/);
    assert.throws(() => setStorageDriver(null), /存储驱动不合法/);
  });
}

// ---- 执行 ----

console.log('存储驱动契约测试');

const kvModule = await import('../server/lib/utils/kv.js');

// 1) 内存模拟驱动（充当「已注入」的驱动，验证门面语义）
const localDriver = createFakeLocalDriver();
await runContractSuite('注入驱动 · 内存模拟（含 deletePrefix）', localDriver, kvModule);

// 3) 真实 SQLite 驱动（node:sqlite 单表 kv_store）
const { createSqliteDriver } = await import('../server/storage/sqlite.js');
await runContractSuite(
  '自定义驱动 · 真实 SQLite（node:sqlite）',
  createSqliteDriver(':memory:'),
  kvModule
);

// 4) 自定义驱动未实现可选方法时，由门面层降级兜底
const minimalDriver = {
  _s: new Map(),
  async get(k) { return this._s.has(k) ? this._s.get(k) : null; },
  async put(k, v) { this._s.set(k, String(v)); },
  async delete(k) { this._s.delete(k); },
  async list(prefix) {
    return {
      keys: [...this._s.keys()].filter((x) => x.startsWith(prefix)).sort().map((name) => ({ name })),
      complete: true,
    };
  },
};
await runContractSuite('自定义驱动 · 最小实现（无 getJSON / deletePrefix）', minimalDriver, kvModule);

// ---- SQLite 驱动专项（文件持久化 / 通配符转义 / 并发安全）----

console.log('\n[SQLite 驱动专项]');

await it('数据落盘：自动创建目录，且新实例可读取既有数据', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rw-'));
  // 故意用不存在的嵌套目录，验证驱动会自动 mkdir -p
  const dbPath = join(tmp, 'nested', 'repo-watcher.db');

  const d1 = createSqliteDriver(dbPath);
  await d1.put('repo_watcher_config', JSON.stringify({ tz: 'UTC+8' }));
  d1.close();
  assert.ok(existsSync(dbPath), '数据库文件应已创建在嵌套目录中');

  // 重新打开同一个文件，数据必须仍在
  const d2 = createSqliteDriver(dbPath);
  assert.equal(await d2.get('repo_watcher_config'), '{"tz":"UTC+8"}');
  d2.close();
  rmSync(tmp, { recursive: true, force: true });
});

await it('前缀中的下划线按字面量匹配，不被 LIKE 当作通配符', async () => {
  const d = createSqliteDriver(':memory:');
  // 只写一条目标记录，若 _ 被当作通配符，下面两个「干扰键」会被误匹配
  await d.put('repo_watcher_session:abc', '1');
  await d.put('repo_watcher_sessionXabc', '2');
  await d.put('repo_watcher_sessionabc', '3');

  const keys = (await d.list('repo_watcher_session:')).keys.map((k) => k.name);
  assert.deepEqual(keys, ['repo_watcher_session:abc'], '下划线/冒号前缀必须精确匹配');

  const n = await d.deletePrefix('repo_watcher_session:');
  assert.equal(n, 1, 'deletePrefix 不得误删通配符相似键');
  assert.equal(await d.get('repo_watcher_sessionXabc'), '2');
  assert.equal(await d.get('repo_watcher_sessionabc'), '3');
  d.close();
});

await it('百分号字面量不被当作通配符', async () => {
  const d = createSqliteDriver(':memory:');
  await d.put('repo_watcher_a%b', '1');
  await d.put('repo_watcher_aXYZb', '2');
  const keys = (await d.list('repo_watcher_a%b')).keys.map((k) => k.name);
  assert.deepEqual(keys, ['repo_watcher_a%b']);
  d.close();
});

await it('重复 put 同一 key 覆盖而非报错（UPSERT 生效）', async () => {
  const d = createSqliteDriver(':memory:');
  await d.put('repo_watcher_k', 'v1');
  await d.put('repo_watcher_k', 'v2');
  assert.equal(await d.get('repo_watcher_k'), 'v2');
  d.close();
});

await it('大批量写入与列举（200 条）正常', async () => {
  const d = createSqliteDriver(':memory:');
  for (let i = 0; i < 200; i += 1) {
    await d.put(`repo_watcher_bulk:${String(i).padStart(3, '0')}`, `v${i}`);
  }
  const keys = (await d.list('repo_watcher_bulk:')).keys;
  assert.equal(keys.length, 200);
  // 必须按 key 排序，保证与 KV 驱动的 ORDER BY 行为一致
  assert.equal(keys[0].name, 'repo_watcher_bulk:000');
  assert.equal(keys[199].name, 'repo_watcher_bulk:199');
  assert.equal(await d.deletePrefix('repo_watcher_bulk:'), 200);
  d.close();
});

await it('value 含 Unicode 与引号时往返无损', async () => {
  const d = createSqliteDriver(':memory:');
  const tricky = JSON.stringify({ note: '中文"引号"\\反斜杠\n换行 emoji 👀' });
  await d.put('repo_watcher_unicode', tricky);
  assert.equal(await d.get('repo_watcher_unicode'), tricky);
  d.close();
});

// ---- config.js：scheduler 字段与能力位 ----

const cfg = await import('../server/lib/config.js');
const NODE_ENV = { RUNTIME: 'node', CONFIG_ENC_KEY: 'a'.repeat(64) };

console.log('\n[config.js · scheduler 与能力位]');

// 切换到干净的本地驱动，避免与上一轮用例数据互相干扰
kvModule.setStorageDriver(createFakeLocalDriver());

await it('能力位恒为 node（Edge 支持已删除）', async () => {
  assert.deepEqual(cfg.getCapabilities(undefined), { runtime: 'node', scheduler: true });
  assert.deepEqual(cfg.getCapabilities({}), { runtime: 'node', scheduler: true });
});

await it('RUNTIME=node 时判定为 node，且支持内置调度', async () => {
  assert.deepEqual(cfg.getCapabilities(NODE_ENV), { runtime: 'node', scheduler: true });
});

await it('默认配置包含 scheduler 默认值', async () => {
  const c = await cfg.getConfig(NODE_ENV);
  assert.deepEqual(c.scheduler, { enabled: false, intervalMinutes: 30 });
});

await it('scheduler 非敏感字段：getMaskedConfig 原样返回不脱敏', async () => {
  await cfg.saveConfig({ scheduler: { enabled: true, intervalMinutes: 15 } }, NODE_ENV);
  const masked = await cfg.getMaskedConfig(NODE_ENV);
  assert.deepEqual(masked.scheduler, { enabled: true, intervalMinutes: 15 });
});

await it('间隔非法值被钳制到 [1, 1440]', async () => {
  const cases = [
    [0, 1], [-5, 1], [99999, 1440], [1441, 1440], [1, 1], [1440, 1440],
  ];
  for (const [input, expected] of cases) {
    const saved = await cfg.saveConfig(
      { scheduler: { enabled: true, intervalMinutes: input } }, NODE_ENV
    );
    assert.equal(saved.scheduler.intervalMinutes, expected, `intervalMinutes=${input}`);
  }
});

await it('间隔为非数字或缺失时回落到默认 30', async () => {
  for (const bad of ['abc', null, undefined, NaN, {}]) {
    const saved = await cfg.saveConfig({ scheduler: { intervalMinutes: bad } }, NODE_ENV);
    assert.equal(saved.scheduler.intervalMinutes, 30, `intervalMinutes=${String(bad)}`);
  }
});

await it('enabled 仅接受严格 true，字符串 "true" 视为 false', async () => {
  let saved = await cfg.saveConfig({ scheduler: { enabled: 'true' } }, NODE_ENV);
  assert.equal(saved.scheduler.enabled, false);
  saved = await cfg.saveConfig({ scheduler: { enabled: true } }, NODE_ENV);
  assert.equal(saved.scheduler.enabled, true);
});

await it('小数间隔被取整', async () => {
  const saved = await cfg.saveConfig({ scheduler: { intervalMinutes: 7.9 } }, NODE_ENV);
  assert.equal(saved.scheduler.intervalMinutes, 7);
});

await it('保存 scheduler 不与其它配置字段互相覆盖（deepMerge 行为不变）', async () => {
  // 用例间共享同一份配置，因此显式给出期望值，不依赖上一轮残留
  await cfg.saveConfig(
    { tz: 'UTC+9', notifyOnFirstCheck: true, scheduler: { enabled: false, intervalMinutes: 45 } },
    NODE_ENV
  );
  const c = await cfg.getConfig(NODE_ENV);
  assert.equal(c.tz, 'UTC+9');
  assert.equal(c.notifyOnFirstCheck, true);
  assert.deepEqual(c.scheduler, { enabled: false, intervalMinutes: 45 });

  // 仅改 scheduler 时，其它字段必须保留
  await cfg.saveConfig({ scheduler: { enabled: true, intervalMinutes: 10 } }, NODE_ENV);
  const c2 = await cfg.getConfig(NODE_ENV);
  assert.equal(c2.tz, 'UTC+9', '改 scheduler 不应影响 tz');
  assert.equal(c2.notifyOnFirstCheck, true, '改 scheduler 不应影响 notifyOnFirstCheck');
  assert.deepEqual(c2.scheduler, { enabled: true, intervalMinutes: 10 });
});

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
