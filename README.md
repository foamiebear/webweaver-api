# WebWeaver API 后端

WebWeaver 爬虫数据管理台的后端服务。基于 Express 4，实现 [web/docs/api.md](../web/docs/api.md) 中约定的全部接口，并内置**站点配置驱动的抓取流水线**（列表 → 文章 → 图片）与定时调度器。

零原生依赖、零外部服务：数据保存在 JSON 文件中，文章为本地 Markdown 文件，图片下载到本地目录并由本服务静态托管。

## 快速开始

```bash
cd api
npm install
npm start          # 默认监听 http://localhost:3000
```

首次启动会：

1. 创建 `data/` 目录并写入种子数据（3 个账号 + 3 个站点配置）；
2. 启动抓取调度器，3 秒后对到期站点执行第一轮真实抓取。

前端联调：`web/` 已配置 `@nuxtjs/proxy`，把 `/api`、`/images` 代理到 `http://localhost:3000`，并已通过 `@nuxtjs/auth-next`（local 策略）接入 `/api/auth/*`：登录、刷新恢复登录态、登出、改资料后 `$auth.setUser` 同步等均走真实接口。开发时两个服务都启动即可：

```bash
cd web && npm run dev   # http://localhost:6018
```

### 种子账号

| 用户名 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `admin123` | 超级管理员 |
| `editor` | `editor123` | 内容编辑 |
| `viewer` | `viewer123` | 只读访客 |

> 仅在 `data/db.json` 不存在时写入。删除 `data/` 目录即可重置全部数据。

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务监听端口 |
| `REQUIRE_AUTH` | `true` | 强制鉴权：除 `/api/auth/login` 外所有接口要求 `Authorization: Bearer <token>`。前端已通过 `@nuxtjs/auth-next` 自动携带 token；联调旧版前端可设 `REQUIRE_AUTH=false` 临时关闭 |
| `CORS_ORIGIN` | `*` | 允许的跨域来源，逗号分隔多个 |
| `DATA_DIR` | `api/data` | 数据目录位置 |

## 接口实现清单

与 api.md 的对应关系（响应体不带 `{code,data}` 包装，列表接口顶层就是 `{list,total}`）：

| 模块 | 接口 | 状态 |
| --- | --- | --- |
| 仪表盘 | `GET /api/stats` | ✅ 实数据统计（含存储占用、最近任务） |
| 爬取列表 | `GET /api/posts` | ✅ 分页 / keyword(title,url) / site / status |
| 爬取文章 | `GET /api/articles`、`GET /api/articles/:id` | ✅ 第二个接口为 api.md 2.3 规划的全文预览（返回 Markdown `content`） |
| 爬取图床 | `GET /api/images` | ✅ `url` 返回可直接加载的绝对地址，额外双写 `sizeBytes` |
| 爬虫配置 | `GET/POST /api/sites`、`PUT/DELETE /api/sites/:id` | ✅ PUT 同时支持全量与 `{enabled}` 部分更新 |
| 手动抓取 | `POST /api/sites/:id/run`、`GET /api/sites/:id/runs` | ✅ api.md 2.5 规划接口，配合爬虫引擎实现 |
| 认证 | `POST /api/auth/login`（含 `remember` 延长 token）、`POST /api/auth/logout`、`GET /api/auth/me`、`PUT /api/auth/profile`、`PUT /api/auth/password` | ✅ |
| 日志 | `GET /api/auth/login-logs`、`GET /api/auth/audit-logs` | ✅ 额外双写 `success` / `actionCode`（api.md 3.1.6/3.1.7 兼容建议） |
| 安全偏好 | `GET/PUT /api/auth/security-prefs` | ✅ |
| 账号管理 | `GET/POST /api/accounts`、`PUT /api/accounts/:id`、`PUT /api/accounts/:id/status`、`PUT /api/accounts/:id/password`、`DELETE /api/accounts/:id` | ✅ 含「不可删除自己 403」「至少保留一个启用超管 403」 |

回归测试：`node test-api.mjs`（需服务已启动，覆盖上述全部接口共 61 项断言）。

## 抓取引擎

`src/crawler/` 下按流水线组织，每个站点的抓取分三个阶段，各自产生一条任务记录（可在仪表盘「最近抓取任务」看到）：

1. **列表**（`列表`）：请求站点 `url`，用 `listSelector` + `linkSelector` 抽取条目链接，按 URL 去重后写入 posts（`status=pending`）。
2. **文章**（`文章`）：取该站点待清洗条目（每轮最多 10 条），请求详情页，用 `titleSelector` / `contentSelector` / `timeSelector` 抽取标题、正文与发布时间；正文转 Markdown 存到 `data/articles/YYYY/MM/<post id>.md`，生成 article 记录，post 置为 `cleaned`（失败置 `failed` 并记录原因）。
3. **图片**（`图片`）：文章阶段发现的正文图片进入全局下载队列，本阶段逐张下载（每轮最多 20 张）到 `data/images/`，按 `{站点缩写}-{YYYYMMDD}-{序号}.{ext}` 命名；魔数嗅探格式并解析宽高（PNG/GIF/JPEG/WebP/BMP），生成 image 记录。

- **调度**：`scheduler.js` 每 30 秒检查一次，`enabled` 且距 `lastCrawledAt` 超过 `interval` 分钟的站点自动入队；站点间串行抓取，同站点不会并发。
- **手动触发**：管理台或 `POST /api/sites/:id/run`；站点正在抓取时返回 409。
- **编码**：按 Content-Type / `<meta charset>` 自动识别，支持 gbk/gb2312/big5（`iconv-lite`）。
- **选择器**：使用标准 CSS 选择器（cheerio），支持逗号分组与 `:has()` 等，如种子里的 `ul.module-list li:has(> a[href*="/blog/20"])`。选择器未命中时任务记为「失败」并在任务 message 里给出原因，方便在「爬虫配置」页修正。

## 数据与存储

```
api/data/
├── db.json     # 全部集合：users/sites/posts/articles/images/tasks/loginLogs/auditLogs/imageQueue
├── .secret     # JWT 签名密钥（首次启动随机生成）
├── articles/   # 清洗后的 Markdown，按 年/月 目录归档
└── images/     # 下载的图片，由 GET /images/<文件名> 静态服务
```

内存操作 + 防抖落盘（临时文件 + rename 原子写入），进程退出时自动保存。

## 设计决策与契约偏差说明

- **响应约定**：严格遵循 api.md 1.2——成功只看 HTTP 状态码、无包装壳；错误统一 `{ error: { code, message } }`（api.md 5.3），message 为面向用户的中文文案。
- **时间格式**：全接口统一 ISO 8601（UTC），`null` 表示「从未发生」。
- **手机号返回原文**：api.md 3.1.1 待确认项，选择返回原文而非脱敏——否则「编辑资料」表单会把脱敏串当真值保存。
- **白名单 IP 校验**：在文档正则基础上额外要求每段 ≤255（`999.1.1.1` 会被拒绝），前端正常输入不受影响。
- **账号即用户**：`/api/accounts` 与 `/api/auth/*` 操作同一份账号数据，输出投影不同；任何账号接口不返回密码哈希。
- **删除站点不删除其历史数据**：posts/articles/images 保留，仅移除配置。
- **部分更新语义**：`PUT /api/sites/:id` 只处理 body 中实际出现的字段，`PUT /api/accounts/:id` 同理，缺失字段不会被清空。
- **改密码 / 登出 / 禁用账号** 会吊销该用户已签发的全部 token（下次请求 401）。

## 目录结构

```
api/
├── bin/www                 # 启动入口（端口、调度器、优雅退出）
├── app.js                  # Express 应用（CORS、静态、统一 JSON 错误）
├── src/
│   ├── config.js           # 端口/目录/批次/配额等常量
│   ├── db.js               # JSON 文件数据库
│   ├── auth.js             # scrypt 密码、HS256 JWT、鉴权中间件、日志
│   ├── validate.js         # 与前端表单逐条对齐的校验规则
│   ├── errors.js           # HttpError / asyncHandler
│   ├── util.js             # 时间/体积/耗时格式化、UA 解析、IP 等
│   ├── seed.js             # 首次启动种子数据
│   └── crawler/
│       ├── fetcher.js      # axios 抓取 + 编码识别
│       ├── extract.js      # 选择器抽取 + 正文转 Markdown
│       ├── images.js       # 图片下载、格式嗅探、宽高解析
│       ├── pipeline.js     # 列表→文章→图片 流水线
│       └── scheduler.js    # interval 定时调度
├── routes/api/             # 按模块拆分的路由（stats/posts/articles/images/sites/auth/accounts）
├── data/                   # 运行时数据（已 gitignore）
└── test-api.mjs            # 接口回归测试
```
