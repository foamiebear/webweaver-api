// GET /api/posts —— 爬取列表条目（api.md 2.2）
const express = require('express')
const db = require('../../src/db')
const { pagination } = require('../../src/validate')
const { pageSlice, matchKeyword } = require('./helpers')
const { asyncHandler } = require('../../src/errors')

const router = express.Router()

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { keyword, site, status } = req.query
    const page = pagination(req.query, 10)

    const filtered = db.data.posts
      .filter((p) => matchKeyword([p.title, p.url], keyword))
      .filter((p) => !site || p.site === site)
      .filter((p) => !status || p.status === status)
      // 默认按抓取时间倒序（api.md 2.2 未来改动约定）
      .sort((a, b) => Date.parse(b.crawledAt) - Date.parse(a.crawledAt) || b.id - a.id)

    const { list, total } = pageSlice(filtered, page)
    res.json({
      list: list.map((p) => ({
        id: p.id,
        title: p.title,
        site: p.site,
        url: p.url,
        publishedAt: p.publishedAt === undefined ? null : p.publishedAt,
        crawledAt: p.crawledAt,
        status: p.status,
      })),
      total,
    })
  })
)

module.exports = router
