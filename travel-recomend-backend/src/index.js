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




app.listen(port,() => {
    console.log(`Server is running on port ${port}`)
})