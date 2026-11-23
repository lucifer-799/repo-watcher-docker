/**
 * AES-256-GCM 加解密工具（基于 Web Crypto，Node 运行时通用）
 *
 * 用于加密 KV 中存储的敏感凭据（各平台 token、checkToken、magicpush 等）。
 * 密钥来源：受保护环境变量 CONFIG_ENC_KEY（仅服务端可用，不进 KV）。
 * 密文格式：enc::<iv>:<authTag>:<ciphertext>（base64）
 *
 * 注意：为避免依赖 Node 专属 API，本模块统一使用 Web Crypto 与 Uint8Array，
 * 因此使用 Web Crypto API（crypto.subtle）与原生 Uint8Array 实现。
 */

// 统一获取全局 crypto（Node 18+ 通过 globalThis.crypto 提供 Web Crypto）
const crypto = globalThis.crypto;

const ALGORITHM = 'AES-GCM';

// 环境变量（CONFIG_ENC_KEY 等）可由调用方通过 env 传入，或以全局变量形式提供。
// 由入口函数通过 initEnv(env) 注入，工具函数按需读取。
let runtimeEnv = null;
export function initEnv(env) {
  if (env) runtimeEnv = env;
}
const IV_LENGTH = 12;       // 96 位 IV（GCM 推荐）
const TAG_LENGTH = 16;      // 128 位认证标签

/**
 * 取派生后的 32 字节密钥。
 * 统一返回 Promise<Uint8Array>：hex 分支为同步转换，这里显式包成 async，
 * 避免同一函数有时返回 Promise、有时返回裸 Uint8Array 造成调用方 `await` 行为不一致。
 * @returns {Promise<Uint8Array>}
 */
async function getKey() {
  const env = runtimeEnv || globalThis;
  const key =
    (env && env.CONFIG_ENC_KEY) ||
    (env && env.config_enc_key) ||
    globalThis.CONFIG_ENC_KEY ||
    globalThis.config_enc_key;
  if (!key) {
    throw new Error('服务端未配置 CONFIG_ENC_KEY，无法加解密凭据');
  }
  // 32 字节密钥（256 位）。支持 hex / utf8 原始字符串，统一 sha256 派生到 32 字节。
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return hexToBytes(key);
  }
  // 其它情况：对字符串取 sha256 得到 32 字节（digest 返回 ArrayBuffer，统一成 Uint8Array）
  const digest = await sha256(new TextEncoder().encode(key));
  return new Uint8Array(digest);
}

async function importKey(rawKey) {
  return crypto.subtle.importKey('raw', rawKey, { name: ALGORITHM }, false, ['encrypt', 'decrypt']);
}

function sha256(data) {
  return crypto.subtle.digest('SHA-256', data);
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const ENC_PREFIX = 'enc::';

/**
 * 加密字段明文
 * @param {string} plaintext 明文字符串
 * @returns {Promise<string>} 密文（enc::<iv>:<authTag>:<ciphertext>）
 */
export async function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined) return plaintext;
  if (typeof plaintext !== 'string') plaintext = String(plaintext);
  if (plaintext === '') return plaintext;

  const rawKey = await getKey();
  const key = await importKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    new TextEncoder().encode(plaintext)
  );

  const ctBytes = new Uint8Array(ct);
  // AES-GCM 在 Web Crypto 中 tag 附加在密文尾部
  const enc = ctBytes.subarray(0, ctBytes.length - TAG_LENGTH);
  const tag = ctBytes.subarray(ctBytes.length - TAG_LENGTH);

  const payload = bytesToBase64(concat(iv, tag, enc));
  return `${ENC_PREFIX}${payload}`;
}

/**
 * 解密字段密文
 * @param {string} ciphertext 密文字符串（enc::...）
 * @returns {Promise<string>} 明文字符串
 */
export async function decryptField(ciphertext) {
  if (ciphertext === null || ciphertext === undefined) return ciphertext;
  if (typeof ciphertext !== 'string') return ciphertext;
  if (!ciphertext.startsWith(ENC_PREFIX)) return ciphertext;

  const rawKey = await getKey();
  const key = await importKey(rawKey);
  const raw = ciphertext.slice(ENC_PREFIX.length);
  const buf = base64ToBytes(raw);

  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const enc = buf.subarray(IV_LENGTH + TAG_LENGTH);

  // Web Crypto 要求 tag 拼接在密文尾部
  const data = concat(enc, tag);
  const pt = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, data);
  return new TextDecoder().decode(pt);
}

/**
 * 判断字符串是否为已加密字段
 * @param {string} value
 * @returns {boolean}
 */
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

// ---- 字节 / base64 工具（避免依赖 Node 的 Buffer） ----

function concat(...arrays) {
  let len = 0;
  for (const a of arrays) len += a.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 保留导出以兼容潜在的调用方（如调试）
export { sha256, bytesToHex };
