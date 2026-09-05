// /api/accounts/* —— 账号管理（管理员）（api.md 3.2）
const express = require('express')
const db = require('../../src/db')
const config = require('../../src/config')
const auth = require('../../src/auth')
const { HttpError, asyncHandler } = require('../../src/errors')
const {
  requiredString, optionalString, validEmail, validPassword, validUsername, pagination, bad,
} = require('../../src/validate')
const { publicAccount, pageSlice, matchKeyword } = require('./helpers')
const { todayString } = require('../../src/util')

const router = express.Router()

function findAccount(req) {
  const account = db.data.users.find((u) => u.id === req.params.id)
  if (!account) throw new HttpError(404, 'NOT_FOUND', '账号不存在')
  return account
}

// 保护：系统至少保留一个启用中的超级管理员
function assertNotLastEnabledAdmin(account) {
  if (account.role !== '超级管理员' || account.enabled === false) return
  const activeAdmins = db.data.users.filter((u) => u.role === '超级管理员' && u.enabled !== false)
  if (activeAdmins.length <= 1) {
    throw new HttpError(403, 'LAST_ADMIN', '系统至少需要保留一个启用中的超级管理员')
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { keyword, role, status } = req.query
    const page = pagination(req.query, 10)
    const filtered = db.data.users
      .filter((u) => matchKeyword([u.username, u.nickname, u.email], keyword))
      .filter((u) => !role || u.role === role)
      .filter((u) => !status || (status === 'active' ? u.enabled !== false : u.enabled === false))
    const { list, total } = pageSlice(filtered, page)
    res.json({ list: list.map(publicAccount), total })
  })
)

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body || {}
    const username = validUsername(requiredString(body, 'username', '用户名', { max: 20 }))
    const nickname = requiredString(body, 'nickname', '昵称', { max: 60 })
    const email = validEmail(requiredString(body, 'email', '邮箱', { max: 120 }))
    const phone = optionalString(body, 'phone', { max: 30 })
    const role = requiredString(body, 'role', '角色', { max: 20 })
    if (!config.ROLES.includes(role)) bad(`角色仅支持：${config.ROLES.join(' / ')}`)
    const password = validPassword(body.password, '初始密码')

    if (db.data.users.some((u) => u.username === username)) {
      throw new HttpError(409, 'USERNAME_EXISTS', '用户名已存在')
    }
    if (db.data.users.some((u) => u.email === email)) {
      throw new HttpError(409, 'EMAIL_EXISTS', '邮箱已被使用')
    }

    const account = {
      id: `u_${db.nextId('user')}`,
      username,
      nickname,
      email,
      phone,
      role,
      passwordHash: auth.hashPassword(password),
      enabled: true,
      avatar: '',
      createdAt: todayString(),
      lastLoginAt: null, // 从未登录
      loginCount: 0,
      loginIp: '',
      prefs: null,
    }
    db.data.users.push(account)
    db.save()
    auth.recordAudit(req.user, req, 'account_create', `新增账号「${username}」（${role}）`)
    res.status(201).json(publicAccount(account))
  })
)

// 编辑资料（不含 username 与 password）
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const account = findAccount(req)
    const body = req.body || {}
    const changed = []
    if (body.nickname !== undefined) {
      account.nickname = requiredString(body, 'nickname', '昵称', { max: 60 })
      changed.push('nickname')
    }
    if (body.email !== undefined) {
      const email = validEmail(requiredString(body, 'email', '邮箱', { max: 120 }))
      if (db.data.users.some((u) => u.email === email && u.id !== account.id)) {
        throw new HttpError(409, 'EMAIL_EXISTS', '邮箱已被使用')
      }
      account.email = email
      changed.push('email')
    }
    if (body.phone !== undefined) {
      account.phone = optionalString(body, 'phone', { max: 30 })
      changed.push('phone')
    }
    if (body.role !== undefined) {
      const role = requiredString(body, 'role', '角色', { max: 20 })
      if (!config.ROLES.includes(role)) bad(`角色仅支持：${config.ROLES.join(' / ')}`)
      account.role = role
      changed.push('role')
    }
    db.save()
    auth.recordAudit(req.user, req, 'account_update', `编辑账号「${account.username}」`)
    res.json(publicAccount(account))
  })
)

router.put(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const account = findAccount(req)
    const { enabled } = req.body || {}
    if (typeof enabled !== 'boolean') bad('enabled 必须是布尔值')
    if (!enabled) assertNotLastEnabledAdmin(account)
    account.enabled = enabled
    if (!enabled) {
      // 禁用即吊销其全部会话
      account.tokensValidAfter = Date.now()
    }
    db.save()
    auth.recordAudit(req.user, req, 'account_status', `${enabled ? '启用' : '禁用'}账号「${account.username}」`)
    res.json(publicAccount(account))
  })
)

// 管理员重置密码：不校验旧密码
router.put(
  '/:id/password',
  asyncHandler(async (req, res) => {
    const account = findAccount(req)
    const password = validPassword((req.body || {}).password, '新密码')
    account.passwordHash = auth.hashPassword(password)
    account.tokensValidAfter = Date.now()
    db.save()
    auth.recordAudit(req.user, req, 'account_reset_password', `重置账号「${account.username}」的密码`)
    res.json({ message: '密码重置成功' })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const account = findAccount(req)
    if (req.user && req.user.id === account.id) {
      throw new HttpError(403, 'CANNOT_DELETE_SELF', '不能删除当前登录账号')
    }
    assertNotLastEnabledAdmin(account)
    db.data.users = db.data.users.filter((u) => u.id !== account.id)
    db.save()
    auth.recordAudit(req.user, req, 'account_delete', `删除账号「${account.username}」`)
    res.json({ message: '删除成功' })
  })
)

module.exports = router
