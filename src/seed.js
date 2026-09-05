// 首次启动种子数据：三个演示账号 + 三个真实站点配置
const db = require('./db')
const { hashPassword } = require('./auth')

const SEED_USERS = [
  { username: 'admin', password: 'admin123', nickname: '管理员', role: '超级管理员', email: 'admin@webweaver.dev' },
  { username: 'editor', password: 'editor123', nickname: '编辑陈亮', role: '内容编辑', email: 'chenliang@webweaver.dev' },
  { username: 'viewer', password: 'viewer123', nickname: '访客张北辰', role: '只读访客', email: 'zhangbc@webweaver.dev' },
]

const SEED_SITES = [
  {
    name: '阮一峰的网络日志',
    url: 'https://www.ruanyifeng.com/blog/archives.html',
    listSelector: 'ul.module-list li:has(> a[href*="/blog/20"])',
    linkSelector: 'a',
    titleSelector: 'h1#page-title, h2.asset-name, h1',
    contentSelector: '.entry-content',
    timeSelector: 'abbr.published',
    imageSelector: '.entry-content img',
    interval: 60,
    remark: '科技爱好者周刊与个人博客，MovableType 架构，取归档页最近文章',
  },
  {
    name: 'GitHub Blog',
    url: 'https://github.blog/',
    listSelector: 'article',
    linkSelector: 'h2 a, h3 a',
    titleSelector: 'h1',
    contentSelector: '.entry-content',
    timeSelector: 'time',
    imageSelector: 'img',
    interval: 120,
    remark: 'GitHub 官方工程博客',
  },
  {
    name: '博客园',
    url: 'https://www.cnblogs.com/',
    listSelector: '.post-item',
    linkSelector: '.post-item-title a',
    titleSelector: '#topics .postTitle',
    contentSelector: '#cnblogs_post_body',
    timeSelector: '#post-date',
    imageSelector: 'img',
    interval: 30,
    remark: '开发者社区首页推荐',
  },
]

function seed() {
  const d = db.data
  if (d.meta.seeded) return

  for (const item of SEED_USERS) {
    d.users.push({
      id: `u_${db.nextId('user')}`,
      username: item.username,
      nickname: item.nickname,
      role: item.role,
      email: item.email,
      phone: '',
      avatar: '',
      passwordHash: hashPassword(item.password),
      enabled: true,
      createdAt: new Date().toISOString().slice(0, 10),
      lastLoginAt: null,
      loginCount: 0,
      loginIp: '',
      prefs: null,
    })
  }

  for (const item of SEED_SITES) {
    d.sites.push({
      id: db.nextId('site'),
      ...item,
      enabled: true,
      abbr: require('./util').deriveAbbr(item.url),
      createdAt: new Date().toISOString(),
      lastCrawledAt: null,
    })
  }

  d.meta.seeded = true
  db.saveNow()
  console.log('[seed] 已写入种子数据：3 个账号（admin/editor/viewer）、3 个站点配置')
}

module.exports = { seed }
