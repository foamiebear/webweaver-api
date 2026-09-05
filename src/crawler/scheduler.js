// 定时调度：每 30 秒检查一次，到期（interval 分钟）且启用的站点自动进入抓取队列
const db = require('../db')
const { enqueueSite, isRunning } = require('./pipeline')

const TICK_MS = 30 * 1000

let timer = null

function isDue(site, now = Date.now()) {
  if (!site.enabled) return false
  if (isRunning(site.id)) return false
  if (!site.lastCrawledAt) return true
  const last = Date.parse(site.lastCrawledAt)
  if (Number.isNaN(last)) return true
  return now - last >= site.interval * 60 * 1000
}

function tick() {
  const now = Date.now()
  for (const site of db.data.sites) {
    if (isDue(site, now)) {
      console.log(`[scheduler] 站点到期，加入抓取队列：${site.name}（${site.url}）`)
      enqueueSite(site.id)
    }
  }
}

function start() {
  if (timer) return
  // 启动 3 秒后先跑一轮，让新种子站点尽快产生数据
  setTimeout(tick, 3000)
  timer = setInterval(tick, TICK_MS)
  if (timer.unref) timer.unref()
  console.log('[scheduler] 已启动，每 30 秒检查到期站点')
}

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

module.exports = { start, stop, isDue }
