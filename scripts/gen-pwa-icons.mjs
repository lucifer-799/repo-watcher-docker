// 纯 Node（仅依赖内置 zlib）生成 PWA 所需的高分辨率 PNG 图标。
// 环境无 ImageMagick/sharp，故手写 PNG 解码 -> 双线性缩放 -> 编码。
// 源图：public/favicon_256.png；输出：public/favicon_192.png、public/favicon_512.png。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { inflateSync, deflateSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(__dirname, '..', 'public')

// ---------- PNG 解码 ----------
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG 文件')
  let off = 8
  let width = 0,
    height = 0,
    bitDepth = 0,
    colorType = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`仅支持 8-bit，当前 ${bitDepth}`)
  const channels =
    colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0
  if (!channels) throw new Error(`不支持的 colorType ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  let pos = 0
  const prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    const cur = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v = (v + a) & 255
      else if (filter === 2) v = (v + b) & 255
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
      cur[i] = v
    }
    cur.copy(out, y * stride)
    cur.copy(prev)
  }

  // 统一转成 RGBA
  const rgba = Buffer.alloc(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    const s = p * channels
    const d = p * 4
    if (colorType === 0) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]
      rgba[d + 3] = 255
    } else if (colorType === 2) {
      rgba[d] = out[s]
      rgba[d + 1] = out[s + 1]
      rgba[d + 2] = out[s + 2]
      rgba[d + 3] = 255
    } else if (colorType === 4) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]
      rgba[d + 3] = out[s + 1]
    } else {
      rgba[d] = out[s]
      rgba[d + 1] = out[s + 1]
      rgba[d + 2] = out[s + 2]
      rgba[d + 3] = out[s + 3]
    }
  }
  return { width, height, rgba }
}

// ---------- 双线性缩放 ----------
function resize(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4)
  const rx = (sw - 1) / (dw - 1 || 1)
  const ry = (sh - 1) / (dh - 1 || 1)
  for (let y = 0; y < dh; y++) {
    const sy = y * ry
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, sh - 1)
    const fy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = x * rx
      const x0 = Math.floor(sx)
      const x1 = Math.min(x0 + 1, sw - 1)
      const fx = sx - x0
      const i = (y * dw + x) * 4
      for (let k = 0; k < 4; k++) {
        const a = src[(y0 * sw + x0) * 4 + k]
        const b = src[(y0 * sw + x1) * 4 + k]
        const c = src[(y1 * sw + x0) * 4 + k]
        const d = src[(y1 * sw + x1) * 4 + k]
        const top = a + (b - a) * fx
        const bot = c + (d - c) * fx
        dst[i + k] = Math.round(top + (bot - top) * fy)
      }
    }
  }
  return dst
}

// ---------- PNG 编码（RGBA, filter=0） ----------
function encodePNG(rgba, w, h) {
  const stride = w * 4
  const raw = Buffer.alloc(h * (stride + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

// CRC32（PNG 要求）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ---------- 主流程 ----------
const src = decodePNG(readFileSync(join(PUBLIC, 'favicon_256.png')))
for (const size of [192, 512]) {
  const scaled = resize(src.rgba, src.width, src.height, size, size)
  writeFileSync(join(PUBLIC, `favicon_${size}.png`), encodePNG(scaled, size, size))
  console.log(`generated public/favicon_${size}.png (${size}x${size})`)
}
