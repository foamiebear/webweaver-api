// 服务端校验：规则与前端表单逐条对齐（见 web/docs/api.md 4.1）
const { HttpError } = require('./errors')
const { PAGE_SIZE_MAX } = require('./config')

const URL_RE = /^https?:\/\//
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/
// 6-20 位且同时包含字母与数字
const PASSWORD_RE = /^(?=.*[a-zA-Z])(?=.*\d).{6,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

function bad(message, code = 'INVALID_PARAM') {
  throw new HttpError(400, code, message)
}

function requiredString(body, field, label, { max = 500 } = {}) {
  const v = body[field]
  if (typeof v !== 'string' || !v.trim()) bad(`${label}不能为空`)
  if (v.length > max) bad(`${label}不能超过 ${max} 个字符`)
  return v.trim()
}

function optionalString(body, field, { max = 2000 } = {}) {
  const v = body[field]
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') bad(`${field} 必须是字符串`)
  if (v.length > max) bad(`${field} 不能超过 ${max} 个字符`)
  return v.trim()
}

function validUrl(v, label = 'url') {
  if (!URL_RE.test(v)) bad(`${label} 必须以 http:// 或 https:// 开头`)
  return v
}

function validEmail(v, label = '邮箱') {
  if (!EMAIL_RE.test(v)) bad(`${label} 格式不正确`)
  return v
}

function validPassword(v, label = '密码') {
  if (typeof v !== 'string' || !PASSWORD_RE.test(v)) {
    bad(`${label}须为 6-20 位且同时包含字母和数字`)
  }
  return v
}

function validUsername(v) {
  if (typeof v !== 'string' || !USERNAME_RE.test(v)) {
    bad('用户名须以字母开头，3-20 位字母/数字/下划线')
  }
  return v
}

function validInterval(v) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 10) bad('抓取间隔不能小于 10 分钟')
  return n
}

function validIPv4List(list, field = 'whitelistIps') {
  if (!Array.isArray(list)) bad(`${field} 必须是字符串数组`)
  return list.map((ip) => {
    if (typeof ip !== 'string' || !IPV4_RE.test(ip) || ip.split('.').some((n) => Number(n) > 255)) {
      bad(`IP 格式不正确：${ip}`)
    }
    return ip
  })
}

// 分页参数：page 从 1 开始，pageSize 封顶 PAGE_SIZE_MAX
function pagination(query, defaultPageSize = 10) {
  let page = parseInt(query.page, 10)
  let pageSize = parseInt(query.pageSize, 10)
  if (!Number.isInteger(page) || page < 1) page = 1
  if (!Number.isInteger(pageSize) || pageSize < 1) pageSize = defaultPageSize
  if (pageSize > PAGE_SIZE_MAX) pageSize = PAGE_SIZE_MAX
  return { page, pageSize, offset: (page - 1) * pageSize }
}

module.exports = {
  URL_RE,
  USERNAME_RE,
  PASSWORD_RE,
  EMAIL_RE,
  IPV4_RE,
  bad,
  requiredString,
  optionalString,
  validUrl,
  validEmail,
  validPassword,
  validUsername,
  validInterval,
  validIPv4List,
  pagination,
}
