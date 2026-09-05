// /api 路由汇总。鉴权策略：
//   - /api/auth/login、/logout、/me 无需前置校验（路由内部自行处理 401）
//   - 其余接口经 requireAuth：REQUIRE_AUTH=true 时强制 Bearer token；
//     默认宽松模式仅尝试挂载 req.user（当前前端尚未接入 token，见 api.md 1.1）
const express = require('express')
const { attachUser, requireAuth } = require('../../src/auth')

const authRouter = require('./auth')
const accountsRouter = require('./accounts')
const sitesRouter = require('./sites')
const postsRouter = require('./posts')
const articlesRouter = require('./articles')
const imagesRouter = require('./images')
const statsRouter = require('./stats')

const router = express.Router()

router.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }))

// 尽量解析 token 挂载 req.user（宽松模式下不拦截）
router.use((req, res, next) => {
  attachUser(req)
  next()
})

router.use('/auth', authRouter)
router.use(requireAuth)
router.use('/accounts', accountsRouter)
router.use('/sites', sitesRouter)
router.use('/posts', postsRouter)
router.use('/articles', articlesRouter)
router.use('/images', imagesRouter)
router.use('/stats', statsRouter)

module.exports = router
