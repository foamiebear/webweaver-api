// GET /api/images —— 本地图片资源（api.md 2.4）
const express = require('express')
const db = require('../../src/db')
const { pagination } = require('../../src/validate')
const { pageSlice, matchKeyword, absUrl } = require('./helpers')
const { asyncHandler } = require('../../src/errors')

const router = express.Router()

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { keyword, site } = req.query
    const page = pagination(req.query, 12)

    const filtered = db.data.images
      .filter((i) => matchKeyword([i.name], keyword))
      .filter((i) => !site || i.site === site)
      .sort((a, b) => Date.parse(b.crawledAt) - Date.parse(a.crawledAt) || b.id - a.id)

    const { list, total } = pageSlice(filtered, page)
    res.json({
      list: list.map((i) => ({
        id: i.id,
        name: i.name,
        site: i.site,
        // 可直接被 <el-image> 加载的绝对地址
        url: absUrl(req, `/images/${i.name}`),
        width: i.width || 0,
        height: i.height || 0,
        size: i.size,
        sizeBytes: i.sizeBytes || 0, // 预留数值字段（api.md 2.4 兼容策略）
        crawledAt: i.crawledAt,
      })),
      total,
    })
  })
)

module.exports = router
