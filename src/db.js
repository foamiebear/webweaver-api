// 内嵌 JSON 数据库：全部数据保存在 data/db.json，内存操作 + 防抖落盘（临时文件 + rename 原子写入）
const fs = require('fs')
const path = require('path')
const config = require('./config')

const SAVE_DEBOUNCE = 300

let data = null
let saveTimer = null

function emptyDB() {
  return {
    meta: { seeded: false, counters: {} },
    users: [],
    sites: [],
    posts: [],
    articles: [],
    images: [],
    tasks: [],
    loginLogs: [],
    auditLogs: [],
    imageQueue: [],
  }
}

function ensureDirs() {
  for (const dir of [config.DATA_DIR, config.IMAGES_DIR, config.ARTICLES_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function migrate() {
  // 补齐未来版本可能缺失的集合，保持向前兼容
  const fresh = emptyDB()
  for (const key of Object.keys(fresh)) {
    if (data[key] === undefined) data[key] = fresh[key]
  }
  if (!data.meta) data.meta = fresh.meta
  if (!data.meta.counters) data.meta.counters = {}
}

function init() {
  ensureDirs()
  if (fs.existsSync(config.DB_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(config.DB_FILE, 'utf8'))
    } catch (err) {
      console.error('[db] db.json 解析失败，已重建空库：', err.message)
      data = emptyDB()
    }
  } else {
    data = emptyDB()
  }
  migrate()
  return data
}

// 自增 ID，name 可为 user / site / post / article / image / task / loginLog / auditLog
function nextId(name) {
  const counters = data.meta.counters
  counters[name] = (counters[name] || 0) + 1
  return counters[name]
}

function save() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveNow()
  }, SAVE_DEBOUNCE)
  if (saveTimer.unref) saveTimer.unref()
}

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!data) return
  ensureDirs()
  const tmp = config.DB_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, config.DB_FILE)
}

process.on('exit', () => {
  if (saveTimer) saveNow()
})

module.exports = {
  init,
  save,
  saveNow,
  nextId,
  get data() {
    return data
  },
  get DATA_DIR() {
    return config.DATA_DIR
  },
  get path() {
    return path
  },
}
