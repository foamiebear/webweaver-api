// GET /api/stats —— 仪表盘统计（api.md 2.1）
const express = require('express')
const fs = require('fs')
const db = require('../../src/db')
const config = require('../../src/config')
const { dirSize, humanSize } = require('../../src/util')
const { createdToday } = require('./helpers')
const { asyncHandler } = require('../../src/errors')

const router = express.Router()

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const d = db.data
    const dbSize = fs.existsSync(config.DB_FILE) ? fs.statSync(config.DB_FILE).size : 0

    const usedList = [dirSize(config.ARTICLES_DIR), dirSize(config.IMAGES_DIR), dbSize]
    const storage = config.STORAGE_QUOTAS.map((quota, i) => ({
      name: quota.name,
      used: humanSize(usedList[i]),
      total: humanSize(quota.total),
      percent: Math.min(100, Math.round((usedList[i] / quota.total) * 100)),
    }))

    const recentTasks = d.tasks.slice(-10).reverse().map((t) => ({
      site: t.site,
      type: t.type,
      startedAt: t.startedAt,
      cost: t.cost,
      count: t.count,
      status: t.status,
    }))

    res.json({
      sites: d.sites.length,
      sitesToday: d.sites.filter((s) => createdToday(s)).length,
      posts: d.posts.length,
      postsToday: d.posts.filter((p) => createdToday(p, 'crawledAt')).length,
      articles: d.articles.length,
      articlesToday: d.articles.filter((a) => createdToday(a, 'cleanedAt')).length,
      images: d.images.length,
      imagesToday: d.images.filter((i) => createdToday(i, 'crawledAt')).length,
      pendingClean: d.posts.filter((p) => p.status === 'pending').length,
      runningTasks: d.tasks.filter((t) => t.status === '运行中').length,
      storage,
      recentTasks,
    })
  })
)

module.exports = router
