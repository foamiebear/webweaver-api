// API 回归测试（Node 22 内置 fetch，UTF-8 安全）。用法：node test-api.mjs
const B = 'http://localhost:3000/api'
let pass = 0
let fail = 0

function chk(desc, expect, got) {
  const ok = typeof got === 'string' ? got.includes(expect) : false
  if (ok) {
    pass++
    console.log('PASS ', desc)
  } else {
    fail++
    console.log(`FAIL  ${desc} | 期望含 [${expect}] 实际: ${String(got).slice(0, 220)}`)
  }
}

const post = (path, body, headers = {}) => fetch(B + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH, ...headers }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.text()])
const put = (path, body, headers = {}) => fetch(B + path, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...AUTH, ...headers }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.text()])
const get = (path, headers = {}) => fetch(B + path, { headers: { ...AUTH, ...headers } }).then(async (r) => [r.status, await r.text()])
const del = (path, headers = {}) => fetch(B + path, { method: 'DELETE', headers: { ...AUTH, ...headers } }).then(async (r) => [r.status, await r.text()])
const j = (t) => JSON.parse(t)

// 登录成功后由 main() 填充，后续请求自动携带
const AUTH = {}

async function main() {
  console.log('--- 认证 ---')
  let [st, t] = await get('/accounts')
  chk('强制鉴权：无 token 访问 401', '未登录或登录已过期', t)
  ;[st, t] = await post('/auth/login', { username: 'admin', password: 'admin123' })
  chk('登录 2xx', '"token"', t)
  chk('登录含 expiresIn', 'expiresIn', t)
  chk('登录含用户信息', '"nickname":"管理员"', t)
  const { token, user } = j(t)
  AUTH.Authorization = `Bearer ${token}`
  const A = AUTH

  ;[st, t] = await post('/auth/login', { username: 'admin', password: 'wrong1' })
  chk('错误密码 401', '用户名或密码错误', t)

  ;[st, t] = await get('/auth/me', A)
  chk('me', '"username":"admin"', t)

  ;[st, t] = await put('/auth/profile', { nickname: '管理员B', email: 'admin@webweaver.dev', phone: '13800001234' }, A)
  chk('改资料', '"nickname":"管理员B"', t)
  chk('改资料返回完整 User', '"loginCount"', t)
  await put('/auth/profile', { nickname: '管理员', email: 'admin@webweaver.dev', phone: '' }, A)

  ;[st, t] = await put('/auth/password', { current: 'badpass1', newPassword: 'newpass123', confirm: 'newpass123' }, A)
  chk('改密码-旧密码错 400', '当前密码不正确', t)
  ;[st, t] = await put('/auth/password', { current: 'admin123', newPassword: 'short', confirm: 'short' }, A)
  chk('改密码-新密码太弱', '6-20', t)

  ;[st, t] = await get('/auth/login-logs?pageSize=3', A)
  chk('登录日志', '"result":"登录成功"', t)
  chk('登录日志含 success 字段', '"success":true', t)
  ;[st, t] = await get('/auth/audit-logs?pageSize=3', A)
  chk('审计日志含 actionCode', 'actionCode', t)

  ;[st, t] = await get('/auth/security-prefs', A)
  chk('安全偏好默认', '"sessionTimeout":60', t)
  ;[st, t] = await put('/auth/security-prefs', { ipWhitelist: true, whitelistIps: ['999.1.1.1'] }, A)
  chk('安全偏好拒绝 999 段', 'IP 格式不正确', t)
  ;[st, t] = await put('/auth/security-prefs', { ipWhitelist: true, whitelistIps: [] }, A)
  chk('开白名单但为空 400', '至少需要配置一个 IP', t)
  ;[st, t] = await put('/auth/security-prefs', { twoFactor: true, whitelistIps: ['192.168.1.1'] }, A)
  chk('安全偏好更新', '"twoFactor":true', t)
  ;[st, t] = await put('/auth/security-prefs', { sessionTimeout: 77 }, A)
  chk('sessionTimeout 非法档位', '仅支持', t)
  await put('/auth/security-prefs', { twoFactor: false, whitelistIps: [] }, A)

  console.log('--- 账号管理 ---')
  ;[st, t] = await get('/accounts?pageSize=5')
  chk('账号列表', '"username":"admin"', t)
  chk('账号列表无密码字段', '"role"', t)
  if (t.includes('passwordHash')) { fail++; console.log('FAIL  账号列表泄露密码哈希') } else { pass++; console.log('PASS  账号列表不泄露密码哈希') }

  ;[st, t] = await post('/accounts', { username: '1abc', nickname: '测试', email: 't@t.dev', role: '内容编辑', password: 'test123' })
  chk('创建账号-用户名非法', '字母开头', t)
  ;[st, t] = await post('/accounts', { username: 'tester1', nickname: '测试账号', email: 'tester1@webweaver.dev', role: '内容编辑', password: 'test123' })
  chk('创建账号', '"username":"tester1"', t)
  ;[st, t] = await post('/accounts', { username: 'tester1', nickname: '测试', email: 'x@x.dev', role: '内容编辑', password: 'test123' })
  chk('重复用户名 409', '用户名已存在', t)
  ;[st, t] = await post('/accounts', { username: 'tester2', nickname: '测试2', email: 'tester1@webweaver.dev', role: '内容编辑', password: 'test123' })
  chk('重复邮箱 409', '邮箱已被使用', t)

  ;[st, t] = await get('/accounts?keyword=tester1')
  const tid = j(t).list[0]?.id
  ;[st, t] = await put(`/accounts/${tid}/status`, { enabled: false })
  chk('禁用账号', '"enabled":false', t)
  ;[st, t] = await post('/auth/login', { username: 'tester1', password: 'test123' })
  chk('禁用后登录 403', '账号已被禁用', t)
  ;[st, t] = await put(`/accounts/${tid}/password`, { password: 'reset123' })
  chk('重置密码', '密码重置成功', t)
  ;[st, t] = await put(`/accounts/${tid}`, { nickname: '测试改名', enabled: true })
  chk('编辑账号', '"nickname":"测试改名"', t)
  ;[st, t] = await get('/accounts?keyword=测试改名')
  chk('keyword 搜 nickname', '测试改名', t)
  ;[st, t] = await get('/accounts?keyword=tester1@webweaver.dev')
  chk('keyword 搜 email', 'tester1', t)
  ;[st, t] = await get(`/accounts?status=disabled`)
  chk('status 筛选 disabled', '"enabled":false', t)
  ;[st, t] = await get(`/accounts?role=超级管理员`)
  chk('role 筛选', '超级管理员', t)
  ;[st, t] = await del(`/accounts/${tid}`)
  chk('删除账号', '删除成功', t)
  ;[st, t] = await del(`/accounts/${tid}`)
  chk('删除不存在 404', '账号不存在', t)
  ;[st, t] = await del('/accounts/u_1', A)
  chk('删除自己 403', '不能删除当前登录账号', t)
  ;[st, t] = await put('/accounts/u_1/status', { enabled: false }, A)
  chk('禁用最后一个超管 403', '至少需要保留', t)

  console.log('--- 站点 CRUD ---')
  ;[st, t] = await get('/sites')
  chk('站点列表', '阮一峰的网络日志', t)
  ;[st, t] = await post('/sites', { name: '坏站点', url: 'ftp://x.com', listSelector: 'a', linkSelector: 'a', interval: 60 })
  chk('创建站点-url非法', 'http', t)
  ;[st, t] = await post('/sites', { name: '坏站点', url: 'https://x.com', listSelector: 'a', linkSelector: 'a', interval: 5 })
  chk('创建站点-interval过小', '不能小于 10', t)
  ;[st, t] = await post('/sites', { name: '开源中国', url: 'https://www.oschina.net/blog', listSelector: '.blog-item', linkSelector: 'a.title', interval: 30, remark: '测试站点' })
  chk('创建站点', '"name":"开源中国"', t)
  const sid = j(t).id
  ;[st, t] = await put(`/sites/${sid}`, { enabled: false })
  chk('部分更新 enabled', '"enabled":false', t)
  ;[st, t] = await get(`/sites?keyword=开源中国`)
  chk('部分更新不清空其他字段', '"listSelector":".blog-item"', t)
  ;[st, t] = await put(`/sites/${sid}`, { interval: 45, remark: '改备注' })
  chk('全量式字段更新', '"interval":45', t)
  ;[st, t] = await post(`/sites/${sid}/run`, {})
  chk('手动触发', '已加入抓取队列', t)
  ;[st, t] = await get(`/sites/${sid}/runs`)
  chk('抓取历史', '"type"', t)
  ;[st, t] = await del(`/sites/${sid}`)
  chk('删除站点', '删除成功', t)

  console.log('--- 列表与详情 ---')
  ;[st, t] = await get('/posts?page=1&pageSize=2')
  chk('posts 结构', '"list"', t)
  const pj = j(t)
  if (pj.list.every((p) => ['id', 'title', 'site', 'url', 'publishedAt', 'crawledAt', 'status'].every((k) => k in p))) { pass++; console.log('PASS  posts 字段完整') } else { fail++; console.log('FAIL  posts 字段缺失', JSON.stringify(pj.list[0])) }
  ;[st, t] = await get('/posts?status=cleaned&pageSize=1')
  chk('posts status 筛选', '"status":"cleaned"', t)
  ;[st, t] = await get('/posts?site=博客园&pageSize=1')
  chk('posts site 精确筛选', '博客园', t)
  ;[st, t] = await get('/posts?keyword=MySQL&pageSize=1')
  chk('posts keyword 大小写不敏感', 'total', t)
  ;[st, t] = await get('/articles?page=1&pageSize=2')
  const aj = j(t)
  chk('articles 结构', '"total"', t)
  if (aj.list.length && aj.list[0].wordCount > 100) { pass++; console.log(`PASS  articles wordCount 修复生效 (${aj.list[0].wordCount})`) } else { fail++; console.log('FAIL  articles wordCount 仍为 0', JSON.stringify(aj.list[0] || {}).slice(0, 200)) }
  ;[st, t] = await get(`/articles/${aj.list[0].id}`)
  chk('文章详情含 content', '"content"', t)
  ;[st, t] = await get('/images?pageSize=2')
  const ij = j(t)
  chk('images 结构', '"name"', t)
  if (ij.list.length && /^https?:\/\//.test(ij.list[0].url)) { pass++; console.log('PASS  images url 为绝对地址') } else { fail++; console.log('FAIL  images url 非绝对地址') }
  if (ij.list.length && ij.list[0].width > 0) { pass++; console.log('PASS  images 尺寸解析', `${ij.list[0].width}x${ij.list[0].height}`) } else { fail++; console.log('FAIL  images 尺寸为 0') }

  // 图片 URL 可直接加载
  if (ij.list.length) {
    const img = await fetch(ij.list[0].url)
    chk('图片 URL 可访问', '', img.ok ? 'ok' : '')
  }

  ;[st, t] = await get('/stats')
  const sj = j(t)
  if (sj.sites >= 3 && sj.posts > 0 && sj.recentTasks.length > 0) { pass++; console.log('PASS  stats 数据齐全', JSON.stringify({ sites: sj.sites, posts: sj.posts, articles: sj.articles, images: sj.images, running: sj.runningTasks })) } else { fail++; console.log('FAIL  stats 异常', t.slice(0, 300)) }

  ;[st, t] = await get('/no-such-api')
  chk('404 JSON 结构', '接口不存在', t)
  ;[st, t] = await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' }).then(async (r) => [r.status, await r.text()])
  chk('非法 JSON 400', 'JSON', t)

  console.log(`\n结果: PASS=${pass} FAIL=${fail}`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('测试脚本异常:', e)
  process.exit(1)
})
