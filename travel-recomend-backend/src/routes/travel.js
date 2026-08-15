import express from "express";
import TravelService from "../services/travelService.js";
import { createResponseStream } from "../utils/streamUtils.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { stateManager } from "../services/stateManager.js";

const router = express.Router()
const travelService = new TravelService()

router.post('/recommend', asyncHandler(async (req, res) => {
    const { city, budget, days, sessionId } = req.body

    // 参数校验放在 HTTP 边界：非法输入返回 400，而不是让 service 抛异常
    if (!city || budget === undefined || budget === null || days === undefined || days === null) {
        return res.status(400).json({
            success:false,
            message:'缺少必要参数'
        })
    }

    const budgetNum = Number(budget)
    const daysNum = Number(days)
    if (!Number.isFinite(budgetNum) || budgetNum < 100) {
        return res.status(400).json({
            success:false,
            message:'预算不能低于100元'
        })
    }
    if (!Number.isInteger(daysNum) || daysNum < 1 || daysNum > 30) {
        return res.status(400).json({
            success:false,
            message:'天数必须在1-30天之间'
        })
    }

    // 会话：传了 sessionId 就把行程草案关联到该会话（chat 可引用）；没传就新建
    const session = stateManager.ensureSession(sessionId)

    // service 返回的就是通过 schema 校验的行程数据；
    // 校验重试耗尽仍失败时 service 抛异常，由全局错误中间件返回 500
    const response = await travelService.recommend(city, budgetNum, daysNum, session.sessionId)

    return res.json({
        success:true,
        data:response,
        sessionId: session.sessionId
    })
}))

router.post('/chat', asyncHandler(async (req, res) => {
    const { message, sessionId } = req.body
    if(!message) {
        return res.status(400).json({
            success:false,
            message:'缺少必要参数'
        })
    }

    // 会话：不存在则创建；客户端用 done 事件里的 sessionId 记住它
    const session = stateManager.ensureSession(sessionId)

    // sse 流式接口返回处理
    // 事件协议：chunk（增量文本）/ done（正常结束，携带 sessionId）/ error（异常结束）
    const responseStream = createResponseStream(res)
    try {
        await travelService.chat(session.sessionId, message, (chunk) => {
            responseStream.send({ type:'chunk', content:chunk})
        })
        responseStream.done({ sessionId: session.sessionId })
    } catch (error) {
        // 流已建立后出错：通过 SSE error 事件结束，而不是让异常冒泡
        console.error('对话接口错误：', error)
        responseStream.error(error.message || '对话失败')
    }
}))

export default router