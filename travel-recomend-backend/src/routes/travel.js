import express from "express";
import TravelService from "../services/travelService.js";
import { createResponseStream } from "../utils/streamUtils.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = express.Router()
const travelService = new TravelService()

router.post('/recommend', asyncHandler(async (req, res) => {
    const { city, budget, days } = req.body

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

    const response = await travelService.recommend(city, budgetNum, daysNum)

    // service 内部会把 JSON 解析失败降级为 { success:false, ... }
    // 这里用 500 表达"服务端未能完成任务"，保持单层契约：非 2xx 即失败
    if (response.success === false) {
        return res.status(500).json({
            success:false,
            message:'模型输出解析失败，请重试'
        })
    }

    return res.json({
        success:true,
        data:response
    })
}))

router.post('/chat', asyncHandler(async (req, res) => {
    const { message } = req.body
    if(!message) {
        return res.status(400).json({
            success:false,
            message:'缺少必要参数'
        })
    }

    // sse 流式接口返回处理
    // 事件协议：chunk（增量文本）/ done（正常结束）/ error（异常结束）
    const responseStream = createResponseStream(res)
    try {
        await travelService.chat(message,(chunk) => {
            responseStream.send({ type:'chunk', content:chunk})
        })
        responseStream.done()
    } catch (error) {
        // 流已建立后出错：通过 SSE error 事件结束，而不是让异常冒泡
        console.error('对话接口错误：', error)
        responseStream.error(error.message || '对话失败')
    }
}))

export default router