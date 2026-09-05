// GET /api/articles、GET /api/articles/:id —— 清洗后的文章（api.md 2.3 + 2.3 规划的全文预览）
const express = require('express')
const fs = require('fs')
const db = require('../../src/db')
const { HttpError, asyncHandler } = require('../../src/errors')
const { pagination } = require('../../src/validate')
const { pageSlice, matchKeyword } = require('./helpers')

const router = express.Router()

function toListItem(a) {
  return {
    id: a.id,
    title: a.title,
    site: a.site,
    author: a.author || '',
    wordCount: a.wordCount || 0,
    excerpt: a.excerpt || '',
    savePath: a.savePath,
    crawledAt: a.crawledAt,
    cleanedAt: a.cleanedAt,
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { keyword, site } = req.query
    const page = pagination(req.query, 10)

    const filtered = db.data.articles
      .filter((a) => matchKeyword([a.title, a.author], keyword))
      .filter((a) => !site || a.site === site)
      .sort((a, b) => Date.parse(b.cleanedAt) - Date.parse(a.cleanedAt) || b.id - a.id)

    const { list, total } = pageSlice(filtered, page)
    res.json({ list: list.map(toListItem), total })
  })
)

// 全文预览：返回清洗后的 Markdown 正文
router.get(
  '/:id(\\d+)',
  asyncHandler(async (req, res) => {
    const article = db.data.articles.find((a) => a.id === Number(req.params.id))
    if (!article) throw new HttpError(404, 'NOT_FOUND', '文章不存在')
    let content = ''
    try {
      content = fs.readFileSync(article.savePath, 'utf8')
    } catch {
      throw new HttpError(404, 'FILE_MISSING', '文章文件已不存在')
    }
    res.json({ ...toListItem(article), imageUrls: article.imageUrls || [], content })
  })
)

module.exports = router
