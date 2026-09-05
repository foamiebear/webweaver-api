var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

var db = require('./src/db');
var { seed } = require('./src/seed');
var { HttpError } = require('./src/errors');
var config = require('./src/config');
var apiRouter = require('./routes/api');

var app = express();

// 初始化数据库与首次种子数据
db.init();
seed();

// 信任反代头（Nginx / Nuxt proxy），保证 clientIp / 协议判断正确
app.set('trust proxy', true);

app.use(logger('dev'));

// CORS：允许跨域直连（开发联调或前后端分离部署），可用 CORS_ORIGIN 配置白名单
app.use(function (req, res, next) {
  var origin = req.headers.origin;
  if (origin) {
    var allow =
      config.CORS_ORIGIN === '*' ? origin : config.CORS_ORIGIN.split(',').map((s) => s.trim());
    var allowed = Array.isArray(allow) ? allow.includes(origin) : allow;
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// 抓取到的图片：/images/<文件名> 直接静态服务（<el-image> 可加载）
app.use('/images', express.static(config.IMAGES_DIR, { maxAge: '7d' }));

app.use('/api', apiRouter);

// API 404 统一返回 JSON（注意：业务错误不要使用 404 表达，见 api.md 5.4）
app.use(function (req, res) {
  res
    .status(404)
    .json({ error: { code: 'NOT_FOUND', message: `接口不存在：${req.method} ${req.path}` } });
});

// 统一错误响应：{ error: { code, message } }（api.md 5.3）
app.use(function (err, req, res, next) {
  if (err && err.type === 'entity.parse.failed') {
    return res
      .status(400)
      .json({ error: { code: 'INVALID_JSON', message: '请求体不是合法的 JSON' } });
  }
  if (err instanceof HttpError || (err && err.status && err.code && err.message)) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  console.error('[error]', err);
  res
    .status(err && err.status ? err.status : 500)
    .json({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
});

module.exports = app;
