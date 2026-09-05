// /api/auth/* —— 登录、登出、当前用户、资料、密码、日志、安全偏好（api.md 3.1）
const express = require('express')
const db = require('../../src/db')
const config = require('../../src/config')
const auth = require('../../src/auth')
const { HttpError, asyncHandler } = require('../../src/errors')
const {
  requiredString, optionalString, validEmail, validPassword, validIPv4List, pagination, bad,
} = require('../../src/validate')
const { publicUser, pageSlice } = require('./helpers')
const { nowISO } = require('../../src/util')

const router = express.Router()

function defaultPrefs() {
  return { twoFactor: false, loginNotify: true, sessionTimeout: 60, ipWhitelist: false, whitelistIps: [] }
}

function needUser(req) {
  if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', '未登录或登录已过期')
  return req.user
}

// ---------- 登录 / 登出 / 当前用户 ----------

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password, remember } = req.body || {}
    if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
      bad('用户名和密码不能为空')
    }
    const user = db.data.users.find((u) => u.username === username.trim())
    if (!user || !auth.verifyPassword(password, user.passwordHash)) {
      auth.recordLoginLog(user, req, false, '用户名或密码错误')
      throw new HttpError(401, 'INVALID_CREDENTIALS', '用户名或密码错误')
    }
    if (user.enabled === false) {
      auth.recordLoginLog(user, req, false, '账号已被禁用')
      throw new HttpError(403, 'ACCOUNT_DISABLED', '账号已被禁用，请联系管理员')
    }

    const expiresIn = remember ? config.TOKEN_TTL_REMEMBER : config.TOKEN_TTL
    const token = auth.signToken(user, expiresIn)
    user.lastLoginAt = nowISO()
    user.loginCount = (user.loginCount || 0) + 1
    user.loginIp = require('../../src/util').clientIp(req)
    db.save()
    auth.recordLoginLog(user, req, true, '登录成功')
    auth.recordAudit(user, req, 'login', `登录成功（IP ${user.loginIp}）`)
    res.json({ token, expiresIn, user: publicUser(user) })
  })
)

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    if (req.user) {
      // 吊销当前用户此前签发的所有 token
      req.user.tokensValidAfter = Date.now()
      db.save()
      auth.recordAudit(req.user, req, 'logout', '退出登录')
    }
    res.json({ message: '已退出登录' })
  })
)

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json(publicUser(needUser(req)))
  })
)

// ---------- 个人资料 / 密码 ----------

router.put(
  '/profile',
  asyncHandler(async (req, res) => {
    const user = needUser(req)
    const nickname = requiredString(req.body || {}, 'nickname', '昵称', { max: 60 })
    const email = validEmail(requiredString(req.body || {}, 'email', '邮箱', { max: 120 }))
    const phone = optionalString(req.body || {}, 'phone', { max: 30 })
    user.nickname = nickname
    user.email = email
    user.phone = phone
    db.save()
    auth.recordAudit(user, req, 'update_profile', '修改个人资料')
    res.json(publicUser(user))
  })
)

router.put(
  '/password',
  asyncHandler(async (req, res) => {
    const user = needUser(req)
    const body = req.body || {}
    const current = typeof body.current === 'string' ? body.current : ''
    if (!auth.verifyPassword(current, user.passwordHash)) {
      throw new HttpError(400, 'WRONG_PASSWORD', '当前密码不正确')
    }
    const newPassword = validPassword(body.newPassword, '新密码')
    if (body.confirm !== newPassword) bad('两次输入的新密码不一致')
    user.passwordHash = auth.hashPassword(newPassword)
    // 使所有旧会话失效，需要重新登录
    user.tokensValidAfter = Date.now()
    db.save()
    auth.recordAudit(user, req, 'change_password', '修改登录密码')
    res.json({ message: '密码修改成功，请重新登录' })
  })
)

// ---------- 日志 ----------

router.get(
  '/login-logs',
  asyncHandler(async (req, res) => {
    const page = pagination(req.query, 10)
    const user = req.user
    const filtered = db.data.loginLogs
      .filter((l) => !user || l.userId === user.id) // 未携带 token（宽松模式）时返回全部记录
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
    const { list, total } = pageSlice(filtered, page)
    res.json({ list: list.map(({ userId, ...rest }) => rest), total })
  })
)

router.get(
  '/audit-logs',
  asyncHandler(async (req, res) => {
    const page = pagination(req.query, 10)
    const user = req.user
    const filtered = db.data.auditLogs
      .filter((l) => !user || l.userId === user.id)
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
    const { list, total } = pageSlice(filtered, page)
    res.json({ list: list.map(({ userId, username, ...rest }) => rest), total })
  })
)

// ---------- 安全偏好 ----------

router.get(
  '/security-prefs',
  asyncHandler(async (req, res) => {
    const user = needUser(req)
    res.json({ ...defaultPrefs(), ...(user.prefs || {}) })
  })
)

router.put(
  '/security-prefs',
  asyncHandler(async (req, res) => {
    const user = needUser(req)
    const body = req.body || {}
    const prefs = { ...defaultPrefs(), ...(user.prefs || {}) }

    for (const key of ['twoFactor', 'loginNotify', 'ipWhitelist']) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'boolean') bad(`${key} 必须是布尔值`)
        prefs[key] = body[key]
      }
    }
    if (body.sessionTimeout !== undefined) {
      if (!config.SESSION_TIMEOUTS.includes(body.sessionTimeout)) {
        bad(`sessionTimeout 仅支持 ${config.SESSION_TIMEOUTS.join(' / ')} 分钟`)
      }
      prefs.sessionTimeout = body.sessionTimeout
    }
    if (body.whitelistIps !== undefined) {
      prefs.whitelistIps = validIPv4List(body.whitelistIps)
    }
    if (prefs.ipWhitelist && !prefs.whitelistIps.length) {
      bad('开启 IP 白名单后至少需要配置一个 IP')
    }
    user.prefs = prefs
    db.save()
    auth.recordAudit(user, req, 'update_security', '更新安全偏好设置')
    res.json(prefs)
  })
)

module.exports = router
