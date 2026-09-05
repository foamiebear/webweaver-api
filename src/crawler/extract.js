// HTML 解析与字段抽取：基于站点配置的 CSS 选择器完成列表项定位、详情页字段提取、正文转 Markdown
const cheerio = require('cheerio')

const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'button', 'form',
  'input', 'select', 'textarea', 'nav', 'header', 'footer', 'aside', 'template',
])

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

function absolutize(base, href) {
  if (!href) return null
  href = href.trim()
  if (/^(javascript:|mailto:|tel:|data:|#)/i.test(href)) return null
  try {
    const u = new URL(href, base)
    if (!/^https?:$/.test(u.protocol)) return null
    return u.href
  } catch {
    return null
  }
}

// ---------- 列表页 ----------

// 依据 listSelector + linkSelector 抽取条目链接，返回 [{ url, title }]，已按 URL 去重
function pickListItems(html, baseUrl, site) {
  const $ = cheerio.load(html)
  const items = []
  const seen = new Set()
  $(site.listSelector).each((_, node) => {
    if (items.length >= 500) return false
    const el = $(node)
    let link = null
    if (site.linkSelector) link = el.find(site.linkSelector).first()
    if (!link || !link.attr('href')) {
      if (el.is('a')) link = el
      else link = el.find('a').first()
    }
    if (!link || !link.attr('href')) return
    const url = absolutize(baseUrl, link.attr('href'))
    if (!url || seen.has(url)) return
    const title =
      cleanText(link.attr('title')) ||
      cleanText(link.text()) ||
      cleanText(el.attr('title')) ||
      cleanText(el.text())
    seen.add(url)
    items.push({ url, title: title.slice(0, 300) })
  })
  return items
}

// ---------- 详情页 ----------

function parseDate(text) {
  if (!text) return null
  const s = cleanText(text)
  if (!s) return null
  // ISO / 时间戳样式直接交给 Date
  const direct = Date.parse(s)
  if (!Number.isNaN(direct)) return new Date(direct).toISOString()
  // 2026年9月6日 08:42 / 2026-09-06 08:42:31 / 2026/9/6
  const m = s.match(/(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', sec = '0'] = m
    const date = new Date(+y, +mo - 1, +d, +h, +mi, +sec)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

function firstText($, sel) {
  if (!sel) return ''
  const el = $(sel).first()
  return el.length ? cleanText(el.text()) : ''
}

function pickPublishedAt($, site) {
  const fromEl = (el) => {
    if (!el || !el.length) return null
    return (
      parseDate(el.attr('datetime')) ||
      parseDate(el.attr('data-time') * 1 || el.attr('data-time')) ||
      parseDate(el.attr('content')) ||
      parseDate(el.attr('title')) ||
      parseDate(el.text())
    )
  }
  let t = fromEl(site.timeSelector ? $(site.timeSelector).first() : null)
  if (t) return t
  for (const sel of [
    'meta[property="article:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]',
    'time[datetime]',
  ]) {
    t = parseDate($(sel).first().attr('content') || $(sel).first().attr('datetime'))
    if (t) return t
  }
  t = fromEl($('time').first())
  if (t) return t
  // 正文前部文本兜底匹配
  return parseDate($.root().text().slice(0, 6000).match(/(20\d{2}\s*[年./-].{1,20}?\d{1,2}\s*[月./-]\s*\d{1,2}\s*日?)/)?.[1])
}

function pickAuthor($, site) {
  const candidates = [
    $('meta[name="author"]').attr('content'),
    $('meta[property="article:author"]').attr('content'),
    firstText($, '[rel="author"]'),
    firstText($, '.author'),
    firstText($, '.byline'),
  ]
  const author = cleanText(candidates.find((v) => v && v.length <= 60) || '')
  return site.authorSelector ? firstText($, site.authorSelector) || author : author
}

function pickDetail(html, baseUrl, site) {
  const $ = cheerio.load(html)
  const title =
    firstText($, site.titleSelector) ||
    cleanText($('meta[property="og:title"]').attr('content')) ||
    firstText($, 'h1') ||
    cleanText($('title').text())
  let contentEl = site.contentSelector ? $(site.contentSelector).first() : null
  if (!contentEl || !contentEl.length) contentEl = $('article').first()
  if (!contentEl || !contentEl.length) contentEl = $('body')
  return {
    $,
    contentEl,
    title: cleanText(title).slice(0, 300),
    publishedAt: pickPublishedAt($, site),
    author: pickAuthor($, site),
  }
}

// ---------- 正文 → Markdown ----------

function normalizeSpace(s) {
  return s.replace(/[\t\r\n]+/g, ' ')
}

function convertNode(node, ctx) {
  if (node.type === 'text') {
    const text = normalizeSpace(node.data)
    ctx.plain += text
    return text
  }
  if (node.type !== 'tag' && node.type !== 'root') return ''
  const tag = (node.tagName || '').toLowerCase()
  if (SKIP_TAGS.has(tag)) return ''
  const el = ctx.$(node)
  const children = () => convertChildren(node.children || [], ctx)

  switch (tag) {
    case 'br':
      return '\n'
    case 'hr':
      return '\n\n---\n\n'
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const level = Number(tag[1])
      return `\n\n${'#'.repeat(level)} ${children().trim()}\n\n`
    }
    case 'p':
      return `\n\n${children().trim()}\n\n`
    case 'strong': case 'b': {
      const inner = children().trim()
      return inner ? ` **${inner}** ` : ''
    }
    case 'em': case 'i': {
      const inner = children().trim()
      return inner ? ` *${inner}* ` : ''
    }
    case 'code':
      return `\`${children().trim()}\``
    case 'pre':
      return `\n\n\`\`\`\n${cleanText(el.text())}\n\`\`\`\n\n`
    case 'a': {
      const href = absolutize(ctx.baseUrl, el.attr('href'))
      const text = children().trim()
      if (!href) return text
      return `[${text || href}](${href})`
    }
    case 'img': {
      const src = absolutize(ctx.baseUrl, el.attr('src') || el.attr('data-src') || el.attr('data-original'))
      if (!src) return ''
      if (!ctx.images.includes(src)) ctx.images.push(src)
      ctx.plain += cleanText(el.attr('alt') || ' ') + ' '
      return `\n\n![${cleanText(el.attr('alt') || '')}](${src})\n\n`
    }
    case 'ul': case 'ol': {
      let out = '\n\n'
      let idx = 1
      el.children().each((_, li) => {
        if ((li.tagName || '').toLowerCase() !== 'li') return
        const content = convertChildren(li.children || [], ctx).trim().replace(/\n+/g, ' ')
        out += tag === 'ol' ? `${idx++}. ${content}\n` : `- ${content}\n`
      })
      return `${out}\n`
    }
    case 'blockquote':
      return `\n\n${children().trim().split('\n').map((l) => `> ${l}`).join('\n')}\n\n`
    case 'table': {
      const rows = []
      el.find('tr').each((_, tr) => {
        const cells = []
        ctx.$(tr).find('th,td').each((__, td) => cells.push(convertChildren(td.children || [], ctx).trim().replace(/\|/g, '\\|')))
        if (cells.length) rows.push(`| ${cells.join(' | ')} |`)
      })
      if (!rows.length) return ''
      return `\n\n${rows[0]}\n|${' --- |'.repeat(el.find('tr').first().find('th,td').length)}\n${rows.slice(1).join('\n')}\n\n`
    }
    default:
      return children()
  }
}

function convertChildren(nodes, ctx) {
  let out = ''
  for (const node of nodes) out += convertNode(node, ctx)
  return out
}

// 把正文元素转换为 Markdown；同时收集图片 URL 与纯文本（用于字数/摘要）
function contentToMarkdown($, contentEl, baseUrl) {
  const ctx = { $, baseUrl, images: [], plain: '' }
  let md = convertChildren(contentEl.toArray ? contentEl.toArray() : [contentEl[0]], ctx)
  md = md
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  return {
    markdown: md,
    images: ctx.images,
    plain: ctx.plain.replace(/\s+/g, ' ').trim(),
  }
}

module.exports = {
  absolutize,
  cleanText,
  pickListItems,
  pickDetail,
  pickPublishedAt,
  contentToMarkdown,
}
