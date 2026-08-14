import 'dotenv/config.js'
import express from 'express'
import travelRouter from './routes/travel.js'
import cors from 'cors'
const app = express()

const port = process.env.PORT

app.use(cors())


// 解析 JSON 请求体
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

//创建一个心跳接口
app.get('/heartbeat',(req,res) => {
    res.json({
        message:'服务正常运行',
        timestamp: new Date().toISOString() 
    })
})

app.use('/api/travel',travelRouter)

// 全局错误处理中间件：asyncHandler 捕获的异常统一在这里返回 500
// （Express 4 不会捕获 async 异常，未捕获的 rejection 会直接杀死进程）
app.use((err, req, res, next) => {
    console.error('未捕获错误：', err)
    if (res.headersSent) {
        return next(err)
    }
    res.status(err.status || 500).json({
        success: false,
        message: err.message || '服务器内部错误'
    })
})




app.listen(port,() => {
    console.log(`Server is running on port ${port}`)
})