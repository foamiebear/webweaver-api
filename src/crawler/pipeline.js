// 抓取流水线：列表入库 → 文章清洗 → 图片下载，三级任务串行执行并记录任务日志
const fs = require('fs')
const path = require('path')
const db = require('../db')
const config = require('../config')
const { fetchText, request } = require('./fetcher')
const { pickListItems, pickDetail, contentToMarkdown } = require('./extract')
const { sniffExt, imageSize, downloadImage } = require('./images')
const { nowISO, todayString, humanSize, humanCost, pad, sleep } = require('../util')
const { HttpError } = require('../errors')

// 正在执行的站点（进程内），用于并发去重与 409 判断
const running = new Set()
const queue = []
let draining = false

function isRunning(siteId) {
  return running.has(siteId)
}

// 入队一次站点抓取（调度器与手动触发共用），同站点不会重复入队
function enqueueSite(siteId) {
  if (running.has(siteId) || queue.some((id) => id === siteId)) return false
  queue.push(siteId)
  drain()
  return true
}

async function drain() {
  if (draining) return
  draining = true
  try {
    while (queue.length) {
      const siteId = queue.shift()
      try {
        await runSiteNow(siteId)
      } catch (err) {
        console.error('[pipeline] 站点抓取异常：', err.message)
      }
    }
  } finally {
    draining = false
  }
}

function beginTask(site, type) {
  const task = {
    id: db.nextId('task'),
    siteId: site.id,
    site: site.name,
    type,
    startedAt: nowISO(),
    finishedAt: null,
    costMs: null,
    cost: '',
    count: 0,
    status: '运行中',
    message: '',
  }
  db.data.tasks.push(task)
  db.save()
  return task
}

function finishTask(task, status, count, message) {
  task.finishedAt = nowISO()
  task.costMs = Date.now() - Date.parse(task.startedAt)
  task.cost = humanCost(task.costMs)
  task.status = status
  task.count = count || 0
  task.message = message || ''
  db.save()
}

// 单站点完整流水线：列表 → 文章 → 图片
async function runSiteNow(siteId) {
  const site = db.data.sites.find((s) => s.id === siteId)
  if (!site || running.has(siteId)) return
  running.add(siteId)
  try {
    const listTask = beginTask(site, '列表')
    try {
      const added = await crawlList(site)
      finishTask(listTask, '成功', added)
    } catch (err) {
      finishTask(listTask, '失败', 0, err.message)
    }

    const articleTask = beginTask(site, '文章')
    let cleaned = 0
    try {
      const { cleanedCount, images } = await crawlArticles(site)
      cleaned = cleanedCount
      const queued = enqueueImages(site, images)
      finishTask(articleTask, '成功', cleaned, queued ? `新增待下载图片 ${queued} 张` : '')
    } catch (err) {
      finishTask(articleTask, '失败', cleaned, err.message)
    }

    const imageTask = beginTask(site, '图片')
    try {
      const downloaded = await crawlImages(site)
      finishTask(imageTask, '成功', downloaded)
    } catch (err) {
      finishTask(imageTask, '失败', 0, err.message)
    }

    site.lastCrawledAt = nowISO()
    db.save()
  } finally {
    running.delete(siteId)
  }
}

// ---------- 阶段一：列表抓取 ----------

async function crawlList(site) {
  const { text } = await fetchText(site.url)
  const items = pickListItems(text, site.url, site)
  if (!items.length) throw new Error(`列表选择器未命中任何条目（listSelector: ${site.listSelector}）`)
  const existing = new Set(db.data.posts.filter((p) => p.siteId === site.id).map((p) => p.url))
  let added = 0
  for (const item of items) {
    if (existing.has(item.url)) continue
    db.data.posts.push({
      id: db.nextId('post'),
      siteId: site.id,
      site: site.name,
      title: item.title || item.url,
      url: item.url,
      publishedAt: null,
      crawledAt: nowISO(),
      status: 'pending',
    })
    existing.add(item.url)
    added++
  }
  db.save()
  return added
}

// ---------- 阶段二：文章清洗 ----------

async function crawlArticles(site) {
  const pending = db.data.posts
    .filter((p) => p.siteId === site.id && p.status === 'pending')
    .slice(0, config.ARTICLE_BATCH)
  let cleanedCount = 0
  const images = []
  for (const post of pending) {
    try {
      const detail = await cleanOne(site, post)
      images.push(...detail.images)
      post.status = 'cleaned'
      if (detail.publishedAt) post.publishedAt = detail.publishedAt
      cleanedCount++
    } catch (err) {
      post.status = 'failed'
      post.failReason = err.message
    }
    db.save()
    await sleep(config.FETCH_DELAY)
  }
  return { cleanedCount, images }
}

async function cleanOne(site, post) {
  const { text, url } = await fetchText(post.url)
  const detail = pickDetail(text, url, site)
  const title = detail.title || post.title
  const { markdown, images, plain } = contentToMarkdown(detail.$, detail.contentEl, url)
  if (!markdown) throw new Error('正文选择器未提取到内容')

  const now = new Date()
  const dir = path.join(config.ARTICLES_DIR, String(now.getFullYear()), pad(now.getMonth() + 1, 2))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${pad(post.id, 4)}.md`)
  const header = `# ${title}\n\n> 来源：${site.name} · ${url}\n`
  fs.writeFileSync(file, `${header}\n${markdown}\n`, 'utf8')

  const article = {
    id: db.nextId('article'),
    postId: post.id,
    siteId: site.id,
    site: site.name,
    title,
    author: detail.author,
    wordCount: plain.replace(/\s+/g, '').length,
    excerpt: plain.slice(0, 200),
    savePath: file,
    crawledAt: post.crawledAt,
    cleanedAt: nowISO(),
    imageUrls: images,
  }
  db.data.articles.push(article)
  return { images, publishedAt: detail.publishedAt }
}

// 待下载图片入全局队列（同站点同 URL 去重）
function enqueueImages(site, urls) {
  const known = new Set(db.data.images.filter((i) => i.siteId === site.id).map((i) => i.sourceUrl))
  const queued = new Set(db.data.imageQueue.filter((q) => q.siteId === site.id).map((q) => q.url))
  let added = 0
  for (const url of urls) {
    if (known.has(url) || queued.has(url)) continue
    db.data.imageQueue.push({ siteId: site.id, site: site.name, url, enqueuedAt: nowISO() })
    queued.add(url)
    added++
  }
  if (added) db.save()
  return added
}

// ---------- 阶段三：图片下载 ----------

async function crawlImages(site) {
  const items = db.data.imageQueue.filter((q) => q.siteId === site.id).slice(0, config.IMAGE_BATCH)
  let downloaded = 0
  for (const item of items) {
    try {
      const { buffer, contentType } = await downloadImage(item.url)
      const ext = sniffExt(buffer, contentType)
      const { width, height } = imageSize(buffer)
      const imageId = db.nextId('image')
      const name = `${site.abbr || 'site'}-${todayString().replace(/-/g, '')}-${pad(imageId, 4)}.${ext}`
      fs.writeFileSync(path.join(config.IMAGES_DIR, name), buffer)
      db.data.images.push({
        id: imageId,
        name,
        siteId: site.id,
        site: site.name,
        url: '', // 响应时按请求 host 生成绝对地址
        sourceUrl: item.url,
        width,
        height,
        sizeBytes: buffer.length,
        size: humanSize(buffer.length),
        crawledAt: nowISO(),
      })
      downloaded++
    } catch (err) {
      console.warn('[pipeline] 图片下载失败：', err.message)
    } finally {
      // 无论成败都出队，避免毒丸阻塞
      const idx = db.data.imageQueue.indexOf(item)
      if (idx !== -1) db.data.imageQueue.splice(idx, 1)
    }
    db.save()
    await sleep(config.FETCH_DELAY)
  }
  return downloaded
}

// 手动触发入口；若站点正在抓取或排队则拒绝
function triggerRun(site) {
  if (running.has(site.id) || queue.includes(site.id)) {
    throw new HttpError(409, 'SITE_BUSY', '该站点正在抓取中，请稍后再试')
  }
  enqueueSite(site.id)
}

module.exports = { enqueueSite, triggerRun, isRunning }
