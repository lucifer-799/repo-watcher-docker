/**
 * 管理员凭据与会话管理
 *
 * - 管理员哈希存于 KV: repo_watcher_admin（{ username, hash }）
 * - 使用 PBKDF2（Web Crypto）替代 bcrypt，Edge / Node 通用
 * - refresh token 的 jti 存于 repo_watcher_session:<jti>，登出/改密时删除即吊销
 */

import { kvGetJSON, kvPutJSON, kvDelete, kvDeletePrefix, kvPutIfAbsent } from '../utils/kv.js';

// 统一获取全局 crypto（EdgeOne/Workers 中以 globalThis.crypto 暴露）
const crypto = globalThis.crypto;

const ADMIN_KEY = 'admin';
const SESSION_PREFIX = 'session:';

// 新密码使用的 PBKDF2 迭代次数；旧数据（3 段格式）以 LEGACY_ITERATIONS 验证，不影响既有登录。
const PBKDF2_ITERATIONS = 600000;
const LEGACY_ITERATIONS = 100000;

function b64(buf) {
  const arr = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function b64ToBytes(str) {
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
  // 格式：pbkdf2$<iterations>$<salt>$<hash>（4 段，自带迭代次数，便于日后继续提高而不废老密码）
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('pbkdf2$')) return false;
  const parts = stored.split('$');
  let iterations, saltB64, hashB64;
  if (parts.length === 4) {
    // 新格式：pbkdf2$<iterations>$<salt>$<hash>
    iterations = Number(parts[1]) || LEGACY_ITERATIONS;
    saltB64 = parts[2];
    hashB64 = parts[3];
  } else if (parts.length === 3) {
    // 旧格式：pbkdf2$<salt>$<hash>（迭代次数固定为 100000），保持可验证，不废老密码
    iterations = LEGACY_ITERATIONS;
    saltB64 = parts[1];
    hashB64 = parts[2];
  } else {
    return false;
  }
  const salt = b64ToBytes(saltB64);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  const actual = b64(bits);
  // 定长比较（避免时序侧信道）
  if (actual.length !== hashB64.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ hashB64.charCodeAt(i);
  return diff === 0;
}

export async function getAdmin() {
  return kvGetJSON(ADMIN_KEY);
}

export async function isInitialized() {
  const admin = await getAdmin();
  return !!admin;
}

export async function initAdmin(username, password) {
  const hash = await hashPassword(password);
  await kvPutJSON(ADMIN_KEY, { username, hash, createdAt: new Date().toISOString() });
}

/**
 * 原子初始化管理员：仅在 admin 记录不存在时写入（CAS）。
 * 用于消除 isInitialized() 与 initAdmin() 之间的 TOCTOU 竞态：
 * 并发请求下只有一个能成功，其余返回 false，不会静默覆盖已有管理员。
 * @returns {Promise<boolean>} true=本次成功创建；false=已存在（未覆盖）
 */
export async function initAdminIfAbsent(username, password) {
  const hash = await hashPassword(password);
  const payload = JSON.stringify({ username, hash, createdAt: new Date().toISOString() });
  return kvPutIfAbsent(ADMIN_KEY, payload);
}

export async function verifyAdmin(username, password) {
  const admin = await getAdmin();
  if (!admin) return false;
  if (admin.username !== username) return false;
  return verifyPassword(password, admin.hash);
}

// ---- 会话（refresh token 吊销） ----

export async function saveSession(jti) {
  await kvPutJSON(SESSION_PREFIX + jti, { createdAt: new Date().toISOString() });
}

export async function sessionExists(jti) {
  const s = await kvGetJSON(SESSION_PREFIX + jti);
  return !!s;
}

export async function deleteSession(jti) {
  await kvDelete(SESSION_PREFIX + jti);
}

export async function deleteAllSessions() {
  // 改密/全量登出时，删除 KV 中所有 session:<jti> 记录。
  // requireAccess 会因此对所有 access token 返回 401（sessionExists 失败），实现全量吊销。
  // 走 kvDeletePrefix：SQLite 驱动可用单条 DELETE 完成，KV 驱动退化为 list + 逐条 delete。
  await kvDeletePrefix(SESSION_PREFIX);
}

/**
 * 修改管理员密码
 * @param {string} oldPassword 原密码（明文）
 * @param {string} newPassword 新密码（明文，至少 6 位）
 */
export async function changePassword(oldPassword, newPassword) {
  const admin = await getAdmin();
  if (!admin) throw new Error('管理员未初始化');
  if (!(await verifyPassword(oldPassword, admin.hash))) {
    throw new Error('原密码错误');
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    throw new Error('新密码至少 6 位');
  }
  const hash = await hashPassword(newPassword);
  await kvPutJSON(ADMIN_KEY, { ...admin, hash, updatedAt: new Date().toISOString() });
}
