import 'dotenv/config.js'
import express from 'express'
import travelRouter from './routes/travel.js'
import cors from 'cors'
import { createRateLimiter } from './middleware/rateLimiter.js'
import { logger } from './utils/logger.js'
const app = express()

const port = process.env.PORT

app.use(cors())

// 解析 JSON 请求体
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

//创建一个心跳接口（不限流——健康检查永远可用）
app.get('/heartbeat',(req,res) => {
    res.json({
        message:'服务正常运行',
        timestamp: new Date().toISOString()
    })
})

// API 路由：限流保护（LLM 接口是成本敏感资源，默认 60 秒内最多 30 次/IP）
app.use('/api', createRateLimiter({ windowMs: 60_000, max: 30 }))
app.use('/api/travel',travelRouter)

// 404：未匹配任何路由的请求
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: '接口不存在'
    })
})

// 全局错误处理中间件：asyncHandler 捕获的异常统一在这里返回 500
// （Express 4 不会捕获 async 异常，未捕获的 rejection 会直接杀死进程）
app.use((err, req, res, next) => {
    logger.error('未捕获错误：', err)
    if (res.headersSent) {
        return next(err)
    }
    res.status(err.status || 500).json({
        success: false,
        message: err.message || '服务器内部错误'
    })
})

// 进程级最后防线：全局中间件之外的兜底（如事件回调里抛出的异常）
process.on('unhandledRejection', (reason) => {
    logger.error('未处理的 Promise 拒绝：', reason)
})
process.on('uncaughtException', (error) => {
    logger.error('未捕获异常，进程退出：', error)
    process.exit(1)
})

app.listen(port,() => {
    logger.info(`Server is running on port ${port}`)
})