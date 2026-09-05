const path = require('path')

const ROOT = path.join(__dirname, '..')
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data')

module.exports = {
  ROOT,
  DATA_DIR,
  DB_FILE: path.join(DATA_DIR, 'db.json'),
  SECRET_FILE: path.join(DATA_DIR, '.secret'),
  IMAGES_DIR: path.join(DATA_DIR, 'images'),
  ARTICLES_DIR: path.join(DATA_DIR, 'articles'),

  PORT: process.env.PORT || '3000',

  // 是否强制鉴权。默认开启：前端（@nuxtjs/auth-next）已接入 Authorization: Bearer token。
  // 若需临时关闭（如旧版前端联调），设置 REQUIRE_AUTH=false
  REQUIRE_AUTH: process.env.REQUIRE_AUTH !== 'false',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',

  TOKEN_TTL: 24 * 3600, // 默认 token 有效期（秒）
  TOKEN_TTL_REMEMBER: 30 * 24 * 3600, // 勾选「记住登录状态」时的有效期

  PAGE_SIZE_MAX: 200,

  ARTICLE_BATCH: 10, // 文章阶段单次最多清洗条数
  IMAGE_BATCH: 20, // 图片阶段单次最多下载数
  FETCH_TIMEOUT: 20000, // 单次请求超时 ms
  FETCH_DELAY: 400, // 同站点连续请求间隔 ms
  MAX_IMAGE_BYTES: 20 * 1024 * 1024,

  ROLES: ['超级管理员', '内容编辑', '只读访客'],
  CLEAN_STATUS: ['cleaned', 'pending', 'failed'],
  SESSION_TIMEOUTS: [30, 60, 120, 480],

  // 存储配额仅用于仪表盘占用百分比展示
  STORAGE_QUOTAS: [
    { name: '文章库', total: 2 * 1024 ** 3 },
    { name: '图片库', total: 10 * 1024 ** 3 },
    { name: '数据库', total: 200 * 1024 ** 2 },
  ],
}
