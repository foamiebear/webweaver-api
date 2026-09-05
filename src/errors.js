// 统一的业务错误：路由里 throw / next(err) 都会走到 app.js 的 JSON 错误处理
class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

// 包装 async 路由处理函数，把 Promise rejection 交给 Express 错误中间件
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

module.exports = { HttpError, asyncHandler }
