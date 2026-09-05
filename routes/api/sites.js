// /api/sites —— 爬虫站点配置 CRUD + 手动抓取 + 抓取历史（api.md 2.5）
const express = require('express')
const db = require('../../src/db')
const { HttpError, asyncHandler } = require('../../src/errors')
const {
  requiredString, optionalString, validUrl, validInterval, pagination, bad,
} = require('../../src/validate')
const { pageSlice, matchKeyword } = require('./helpers')
const { recordAudit } = require('../../src/auth')
const { deriveAbbr, nowISO } = require('../../src/util')
const pipeline = require('../../src/crawler/pipeline')

const router = express.Router()

// 可通过 body 更新的字段与各自校验器
const FIELD_VALIDATORS = {
  name: (v) => requiredString({ name: v }, 'name', '站点名称', { max: 60 }),
  url: (v) => validUrl(requiredString({ url: v }, 'url', '起始 URL', { max: 2000 })),
  listSelector: (v) => requiredString({ listSelector: v }, 'listSelector', '列表选择器', { max: 300 }),
  linkSelector: (v) => requiredString({ linkSelector: v }, 'linkSelector', '链接选择器', { max: 300 }),
  titleSelector: (v) => optionalString({ titleSelector: v }, 'titleSelector', { max: 300 }),
  contentSelector: (v) => optionalString({ contentSelector: v }, 'contentSelector', { max: 300 }),
  timeSelector: (v) => optionalString({ timeSelector: v }, 'timeSelector', { max: 300 }),
  imageSelector: (v) => optionalString({ imageSelector: v }, 'imageSelector', { max: 300 }),
  interval: (v) => validInterval(v),
  remark: (v) => optionalString({ remark: v }, 'remark', { max: 500 }),
  enabled: (v) => {
    if (typeof v !== 'boolean') bad('enabled 必须是布尔值')
    return v
  },
}

function toResponse(site) {
  return {
    ...site,
    lastCrawledAt: site.lastCrawledAt === undefined ? null : site.lastCrawledAt,
  }
}

function findSite(req) {
  const id = Number(req.params.id)
  const site = db.data.sites.find((s) => s.id === id)
  if (!site) throw new HttpError(404, 'NOT_FOUND', '站点配置不存在')
  return site
}

// 从 body 中挑选合法字段并校验（只处理 body 里实际出现的 key，支持部分更新）
function pickFields(body) {
  const out = {}
  for (const [key, validate] of Object.entries(FIELD_VALIDATORS)) {
    if (body[key] === undefined) continue
    out[key] = validate(body[key])
  }
  return out
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { keyword } = req.query
    const page = pagination(req.query, 10)
    const filtered = db.data.sites.filter((s) => matchKeyword([s.name, s.url], keyword))
    const { list, total } = pageSlice(filtered, page)
    res.json({ list: list.map(toResponse), total })
  })
)

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const fields = pickFields(req.body)
    for (const key of ['name', 'url', 'listSelector', 'linkSelector', 'interval']) {
      if (fields[key] === undefined) bad(`${key} 不能为空`)
    }
    const site = {
      id: db.nextId('site'),
      ...fields,
      titleSelector: fields.titleSelector ?? '',
      contentSelector: fields.contentSelector ?? '',
      timeSelector: fields.timeSelector ?? '',
      imageSelector: fields.imageSelector ?? '',
      remark: fields.remark ?? '',
      enabled: fields.enabled ?? true, // 服务端默认启用（api.md 2.5）
      abbr: deriveAbbr(fields.url),
      createdAt: nowISO(),
      lastCrawledAt: null, // 从未抓取显示 '-'
    }
    db.data.sites.push(site)
    db.save()
    recordAudit(req.user, req, 'site_create', `新增站点「${site.name}」`)
    res.status(201).json(toResponse(site))
  })
)

// 同时支持全量更新与部分更新（如 { enabled: true }），缺失字段不清空
router.put(
  '/:id(\\d+)',
  asyncHandler(async (req, res) => {
    const site = findSite(req)
    const fields = pickFields(req.body)
    if (!Object.keys(fields).length) bad('请求体不包含可更新字段')
    const changed = Object.keys(fields)
    Object.assign(site, fields)
    if (fields.url) site.abbr = deriveAbbr(fields.url)
    db.save()
    recordAudit(req.user, req, 'site_update', `编辑站点「${site.name}」（${changed.join(', ')}）`)
    res.json(toResponse(site))
  })
)

router.delete(
  '/:id(\\d+)',
  asyncHandler(async (req, res) => {
    const site = findSite(req)
    db.data.sites = db.data.sites.filter((s) => s.id !== site.id)
    db.save()
    recordAudit(req.user, req, 'site_delete', `删除站点「${site.name}」`)
    res.json({ message: '删除成功' })
  })
)

// 手动触发一次完整抓取（列表 → 文章 → 图片）
router.post(
  '/:id(\\d+)/run',
  asyncHandler(async (req, res) => {
    const site = findSite(req)
    pipeline.triggerRun(site)
    recordAudit(req.user, req, 'site_run', `手动触发抓取「${site.name}」`)
    res.json({ message: '已加入抓取队列' })
  })
)

// 站点抓取历史
router.get(
  '/:id(\\d+)/runs',
  asyncHandler(async (req, res) => {
    const site = findSite(req)
    const page = pagination(req.query, 10)
    const filtered = db.data.tasks
      .filter((t) => t.siteId === site.id)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id - a.id)
    const { list, total } = pageSlice(filtered, page)
    res.json({ list, total })
  })
)

module.exports = router
