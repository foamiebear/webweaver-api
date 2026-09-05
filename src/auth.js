// 认证：scrypt 加盐密码哈希 + 自实现 HS256 JWT（零第三方依赖）
const crypto = require('crypto')
const fs = require('fs')
const db = require('./db')
const config = require('./config')
const { HttpError } = require('./errors')
const { nowISO, clientIp, parseDevice } = require('./util')

// ---------- 密码 ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const calc = crypto.scryptSync(password, salt, 64)
  const expect = Buffer.from(hash, 'hex')
  return calc.length === expect.length && crypto.timingSafeEqual(calc, expect)
}

// ---------- JWT (HS256) ----------

function getSecret() {
  if (getSecret.cached) return getSecret.cached
  if (fs.existsSync(config.SECRET_FILE)) {
    getSecret.cached = fs.readFileSync(config.SECRET_FILE, 'utf8').trim()
  }
  if (!getSecret.cached) {
    getSecret.cached = crypto.randomBytes(48).toString('hex')
    fs.writeFileSync(config.SECRET_FILE, getSecret.cached)
  }
  return getSecret.cached
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

function signToken(user, ttlSec) {
  const iat = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ sub: user.id, iat, exp: iat + ttlSec }))
  const sig = crypto.createHmac('sha256', getSecret()).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

// 校验失败返回 null
function verifyToken(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, sig] = parts
  const expect = crypto.createHmac('sha256', getSecret()).update(`${header}.${payload}`).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expect)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!data.sub || typeof data.exp !== 'number') return null
    if (data.exp * 1000 < Date.now()) return null
    return data
  } catch {
    return null
  }
}

// ---------- 请求上下文 ----------

function extractToken(req) {
  const auth = req.headers.authorization || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

// 尝试解析请求中的用户（token 无效 / 用户被禁用 / 密码修改后会话过期 → null）
function attachUser(req) {
  req.user = null
  const token = extractToken(req)
  if (!token) return null
  const payload = verifyToken(token)
  if (!payload) return null
  const user = db.data.users.find((u) => u.id === payload.sub)
  if (!user || user.enabled === false) return null
  // 改密码 / 登出后吊销此前签发的所有会话
  if (user.tokensValidAfter && payload.iat * 1000 < user.tokensValidAfter) return null
  req.user = user
  req.tokenPayload = payload
  return user
}

function requireAuth(req, res, next) {
  const user = attachUser(req)
  if (!config.REQUIRE_AUTH) return next() // 宽松模式：不强制，但已尽量挂载 req.user
  if (!user) return next(new HttpError(401, 'UNAUTHORIZED', '未登录或登录已过期'))
  next()
}

// ---------- 日志 ----------

function deviceOf(req) {
  return parseDevice(req.headers['user-agent'])
}

function recordLoginLog(user, req, success, result) {
  db.data.loginLogs.push({
    id: `log_${db.nextId('loginLog')}`,
    userId: user ? user.id : null,
    username: user ? user.username : (req.body && req.body.username) || '',
    time: nowISO(),
    ip: clientIp(req),
    device: deviceOf(req),
    result, // '登录成功' 或失败原因
    success,
    location: '',
  })
  db.save()
}

const AUDIT_LABELS = {
  login: '登录',
  logout: '登出',
  change_password: '修改密码',
  update_profile: '编辑资料',
  update_security: '安全设置',
  account_create: '新增账号',
  account_update: '编辑账号',
  account_status: '账号启停',
  account_reset_password: '重置密码',
  account_delete: '删除账号',
  site_create: '新增站点',
  site_update: '编辑站点',
  site_delete: '删除站点',
  site_run: '手动抓取',
}

function recordAudit(user, req, actionCode, detail) {
  db.data.auditLogs.push({
    id: `audit_${db.nextId('auditLog')}`,
    userId: user ? user.id : null,
    username: user ? user.username : '系统',
    time: nowISO(),
    action: AUDIT_LABELS[actionCode] || actionCode,
    actionCode,
    detail: detail || '',
    ip: clientIp(req),
    device: deviceOf(req),
  })
  db.save()
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  extractToken,
  attachUser,
  requireAuth,
  recordLoginLog,
  recordAudit,
  AUDIT_LABELS,
}
