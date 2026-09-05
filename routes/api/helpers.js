// 路由层公共小工具
const { todayStart } = require('../../src/util')

// User 对象输出投影（严禁包含 passwordHash 等内部字段，见 api.md 3.1.1）
function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    role: u.role,
    email: u.email,
    phone: u.phone || '',
    avatar: u.avatar || '',
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt === undefined ? null : u.lastLoginAt,
    loginCount: u.loginCount || 0,
    loginIp: u.loginIp || '',
  }
}

// Account 对象输出投影（api.md 3.2）
function publicAccount(u) {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    email: u.email,
    phone: u.phone || '',
    role: u.role,
    enabled: u.enabled,
    loginCount: u.loginCount || 0,
    lastLoginAt: u.lastLoginAt === undefined ? null : u.lastLoginAt,
    createdAt: u.createdAt,
  }
}

function absUrl(req, p) {
  return `${req.protocol}://${req.get('host')}${p}`
}

// 内存数组分页：arr 需已排好序
function pageSlice(arr, { offset, pageSize }) {
  return { list: arr.slice(offset, offset + pageSize), total: arr.length }
}

// api.md 1.7：keyword 对指定字段做不区分大小写的子串匹配
function matchKeyword(fields, keyword) {
  if (!keyword) return true
  const kw = String(keyword).toLowerCase()
  return fields.some((f) => String(f == null ? '' : f).toLowerCase().includes(kw))
}

function createdToday(record, field = 'createdAt') {
  const v = record[field]
  if (!v) return false
  const t = Date.parse(v)
  return !Number.isNaN(t) && t >= todayStart()
}

module.exports = { publicUser, publicAccount, absUrl, pageSlice, matchKeyword, createdToday }
