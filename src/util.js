const crypto = require('crypto')

// 当前时间 ISO 字符串（UTC，前端 new Date() 可直接解析）
function nowISO() {
  return new Date().toISOString()
}

// 本地时区「今天 00:00」的时间戳，用于统计今日新增
function todayStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// 当地日期 YYYY-MM-DD
function todayString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// 字节数 → 人类可读（保留最多两位小数，整数不带小数点）
function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) bytes = 0
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const rounded = i === 0 ? String(v) : String(parseFloat(v.toFixed(2)))
  return `${rounded} ${units[i]}`
}

// 耗时 → "4m 12s" / "42s"
function humanCost(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function pad(num, width) {
  return String(num).padStart(width, '0')
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// 取客户端 IP：优先代理头（已设置 trust proxy）
function clientIp(req) {
  const raw =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    (req.socket && req.socket.remoteAddress) ||
    ''
  return raw.replace(/^::ffff:/, '') || '未知'
}

// 极简 UA 解析，输出 "Chrome 130 / Windows 11" 风格
function parseDevice(ua = '') {
  ua = String(ua || '')
  let browser = '未知浏览器'
  const rules = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/CriOS\/([\d.]+)/, 'Chrome'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
    [/MSIE ([\d.]+)/, 'IE'],
  ]
  for (const [re, name] of rules) {
    const m = ua.match(re)
    if (m) {
      browser = `${name} ${m[1].split('.')[0]}`
      break
    }
  }
  let os = '未知系统'
  if (/Windows NT 10/.test(ua)) os = 'Windows 10/11'
  else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1'
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/Android ([\d.]+)/.test(ua)) os = `Android ${ua.match(/Android ([\d.]+)/)[1].split('.')[0]}`
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
  else if (/Mac OS X ([\d_.]+)/.test(ua)) os = 'macOS'
  else if (/Linux/.test(ua)) os = 'Linux'
  return `${browser} / ${os}`
}

// 从站点 URL 推导存储缩写，如 https://www.sspai.com → sspai
function deriveAbbr(url) {
  try {
    let host = new URL(url).hostname.toLowerCase()
    host = host.replace(/^www\./, '')
    const parts = host.split('.')
    let core = parts.length >= 2 ? parts[parts.length - 2] : parts[0]
    // 处理 com.cn / org.cn 等二级后缀
    if (parts.length >= 3 && ['com', 'org', 'net', 'gov', 'edu'].includes(parts[parts.length - 2])) {
      core = parts[parts.length - 3]
    }
    const abbr = core.replace(/[^a-z0-9]/g, '').slice(0, 16)
    return abbr || 'site'
  } catch {
    return 'site'
  }
}

// 递归统计目录大小（字节）
function dirSize(dir) {
  const fs = require('fs')
  const path = require('path')
  let total = 0
  if (!fs.existsSync(dir)) return 0
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) total += dirSize(p)
    else total += st.size
  }
  return total
}

function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex')
}

module.exports = {
  nowISO,
  todayStart,
  todayString,
  humanSize,
  humanCost,
  pad,
  sleep,
  isPlainObject,
  clientIp,
  parseDevice,
  deriveAbbr,
  dirSize,
  randomHex,
}
