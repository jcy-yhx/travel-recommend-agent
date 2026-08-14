// 包装 async 路由处理器。
// Express 4 不会自动捕获 async 函数中的异常：未捕获的 rejection
// 会触发 unhandledRejection，直接杀死整个 Node 进程。
// 用 asyncHandler 包装后，异常统一交给全局错误中间件处理。
export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
}
