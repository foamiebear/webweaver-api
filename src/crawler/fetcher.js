// HTTP 抓取：axios + iconv-lite，支持重定向、超时与常见中文编码（gbk/gb2312/big5）
const axios = require('axios')
const iconv = require('iconv-lite')
const config = require('../config')

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const instance = axios.create({
  timeout: config.FETCH_TIMEOUT,
  maxRedirects: 5,
  responseType: 'arraybuffer',
  headers: {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  },
  validateStatus: (s) => s >= 200 && s < 400,
})

function friendlyError(err, url) {
  if (err.response) return `请求被拒绝（HTTP ${err.response.status}）：${url}`
  if (err.code === 'ECONNABORTED') return `请求超时：${url}`
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return `域名无法解析：${url}`
  return `请求失败（${err.code || err.message}）：${url}`
}

async function request(url) {
  let res
  try {
    res = await instance.get(url)
  } catch (err) {
    throw new Error(friendlyError(err, url))
  }
  const contentType = String(res.headers['content-type'] || '')
  // follow-redirects 在 res.request.res 上暴露最终 URL
  const finalUrl = (res.request && res.request.res && res.request.res.responseUrl) || url
  return { buffer: Buffer.from(res.data), contentType, finalUrl }
}

// 从 content-type 头或 HTML meta 标签探测字符集
function detectCharset(buffer, contentType) {
  let m = /charset=["']?([\w-]+)/i.exec(contentType || '')
  if (m) return m[1].toLowerCase()
  const head = buffer.subarray(0, 4096).toString('latin1')
  m = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)
  if (m) return m[1].toLowerCase()
  return 'utf-8'
}

// 抓取 HTML 页面并按正确编码解码为文本
async function fetchText(url) {
  const { buffer, contentType, finalUrl } = await request(url)
  const charset = detectCharset(buffer, contentType)
  let text
  try {
    text = iconv.decode(buffer, charset)
  } catch {
    text = buffer.toString('utf8')
  }
  return { text, contentType, url: finalUrl }
}

module.exports = { fetchText, request, USER_AGENT }
