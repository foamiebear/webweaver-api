// 图片下载与元信息嗅探：魔数判断格式、解析宽高（PNG/GIF/JPEG/WebP/BMP），零第三方依赖
const { request } = require('./fetcher')
const config = require('../config')

const CT_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
}

function sniffExt(buffer, contentType = '') {
  const ct = CT_EXT[(contentType || '').split(';')[0].trim().toLowerCase()]
  if (buffer.length > 24) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png'
    if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'gif'
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg'
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp'
    if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
    if (buffer.subarray(0, 4).toString('latin1') === '<svg') return 'svg'
  }
  return ct || 'jpg'
}

// 解析像素尺寸，失败返回 { width: 0, height: 0 }
function imageSize(buffer) {
  try {
    if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
      // PNG: IHDR 位于固定偏移，大端
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    }
    if (buffer.length > 10 && buffer[0] === 0x47 && buffer[1] === 0x49) {
      // GIF: 逻辑屏幕尺寸，小端
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
    }
    if (buffer.length > 26 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
      // BMP
      return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) }
    }
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      // JPEG: 遍历段标记找 SOF0/1/2
      let off = 2
      while (off + 9 < buffer.length) {
        if (buffer[off] !== 0xff) {
          off++
          continue
        }
        const marker = buffer[off + 1]
        if (marker >= 0xc0 && marker <= 0xc3 && marker !== 0xc1) {
          return { height: buffer.readUInt16BE(off + 5), width: buffer.readUInt16BE(off + 7) }
        }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
          off += 2
        } else {
          off += 2 + buffer.readUInt16BE(off + 2)
        }
      }
    }
    if (buffer.length > 30 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
      const fourcc = buffer.subarray(12, 16).toString('latin1')
      if (fourcc === 'VP8 ') {
        return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
      }
      if (fourcc === 'VP8L') {
        const bits = buffer.readUInt32LE(21)
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
      }
      if (fourcc === 'VP8X') {
        const w = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16))
        const h = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16))
        return { width: w, height: h }
      }
    }
  } catch {
    // fallthrough
  }
  return { width: 0, height: 0 }
}

// 下载图片，超过 MAX_IMAGE_BYTES 拒绝
async function downloadImage(url) {
  const { buffer, contentType } = await request(url)
  if (buffer.length > config.MAX_IMAGE_BYTES) {
    throw new Error(`图片过大（${Math.round(buffer.length / 1024 / 1024)}MB）：${url}`)
  }
  if (contentType && !/^image\//i.test(contentType) && !sniffIsImage(buffer)) {
    throw new Error(`响应不是图片（${contentType.split(';')[0]}）：${url}`)
  }
  return { buffer, contentType }
}

function sniffIsImage(buffer) {
  return ['png', 'gif', 'jpg', 'bmp', 'webp'].includes(sniffExt(buffer, ''))
}

module.exports = { sniffExt, imageSize, downloadImage }
