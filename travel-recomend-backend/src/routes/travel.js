import express from "express";
import TravelService from "../services/travelService.js";
import { createResponseStream } from "../utils/streamUtils.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { stateManager } from "../services/stateManager.js";

const router = express.Router()
const travelService = new TravelService()

// 规划参数校验（/recommend 与 /recommend/stream 共用，避免两份规则漂移）
function validatePlanParams(body) {
    const { city, budget, days } = body
    if (!city || budget === undefined || budget === null || days === undefined || days === null) {
        return { ok: false, message: '缺少必要参数' }
    }
    const normalizedCity = String(city).trim()
    if (!/^[\p{Script=Han}A-Za-z·\s-]{2,30}$/u.test(normalizedCity)) {
        return { ok: false, message: '目的地格式不正确（2-30 个中英文字符）' }
    }
    const budgetNum = Number(budget)
    const daysNum = Number(days)
    if (!Number.isFinite(budgetNum) || budgetNum < 100) {
        return { ok: false, message: '预算不能低于100元' }
    }
    if (!Number.isInteger(daysNum) || daysNum < 1 || daysNum > 30) {
        return { ok: false, message: '天数必须在1-30天之间' }
    }
    return { ok: true, city: normalizedCity, budget: budgetNum, days: daysNum, sessionId: body.sessionId }
}

router.post('/recommend', asyncHandler(async (req, res) => {
    // 参数校验放在 HTTP 边界：非法输入返回 400，而不是让 service 抛异常
    const params = validatePlanParams(req.body)
    if (!params.ok) {
        return res.status(400).json({ success: false, message: params.message })
    }

    // 会话：传了 sessionId 就把行程草案关联到该会话（chat 可引用）；没传就新建
    const session = await stateManager.ensureSession(params.sessionId)

    // service 返回的就是通过 schema 校验的行程数据；
    // 校验重试耗尽仍失败时 service 抛异常，由全局错误中间件返回 500
    const response = await travelService.recommend(params.city, params.budget, params.days, session.sessionId)

    return res.json({
        success: true,
        data: response,
        sessionId: session.sessionId
    })
}))

// 流式规划（Phase 10）：SSE 实时推送 Agent 执行轨迹
// 事件协议：start（开始）→ node（各节点轨迹，可多个）→ done（行程 + usage）/ error
router.post('/recommend/stream', asyncHandler(async (req, res) => {
    const params = validatePlanParams(req.body)
    if (!params.ok) {
        return res.status(400).json({ success: false, message: params.message })
    }

    const session = await stateManager.ensureSession(params.sessionId)
    const responseStream = createResponseStream(res)
    try {
        responseStream.send({ type: 'start', city: params.city, budget: params.budget, days: params.days })
        const { plan, usage } = await travelService.recommendStream(
            params.city, params.budget, params.days, session.sessionId,
            (event) => responseStream.send(event)
        )
        // done() 会写事件并关闭连接——把数据作为 payload 传入，只发一次 done
        responseStream.done({
            sessionId: session.sessionId,
            plan,
            usage
        })
    } catch (error) {
        // 流已建立后出错（图节点抛错）：通过 SSE error 事件结束
        console.error('流式规划错误：', error)
        responseStream.error(error)
    }
}))

// 全局成本统计（Phase 10）：聚合所有会话的 usageLog，纯内存读
router.get('/stats', asyncHandler(async (req, res) => {
    return res.json({
        success: true,
        data: await stateManager.getStats()
    })
}))

// 会话列表（Phase 11）：元数据 + 最近一条用户消息预览，按最近更新排序
router.get('/sessions', asyncHandler(async (req, res) => {
    return res.json({
        success: true,
        data: await stateManager.listSessions()
    })
}))

// 会话详情（Phase 11）：chat 恢复历史 / detail 恢复行程都从这里取
router.get('/sessions/:id', asyncHandler(async (req, res) => {
    const session = await stateManager.getSession(req.params.id)
    if (!session) {
        return res.status(404).json({ success: false, message: '会话不存在' })
    }
    return res.json({
        success: true,
        data: session
    })
}))

// 删除会话（Phase 11）：幂等语义——不存在的会话返回 404
router.delete('/sessions/:id', asyncHandler(async (req, res) => {
    const existed = await stateManager.deleteSession(req.params.id)
    if (!existed) {
        return res.status(404).json({ success: false, message: '会话不存在' })
    }
    return res.json({ success: true })
}))

// 修改行程（Phase 11）：注入旧行程 + 修改指令重跑同一个图。
// SSE 事件协议与 /recommend/stream 相同：start → node×N → done{plan, usage} / error
router.post('/refine', asyncHandler(async (req, res) => {
    const { sessionId, instruction } = req.body
    if (!sessionId || !instruction || !String(instruction).trim()) {
        return res.status(400).json({ success: false, message: '缺少必要参数' })
    }
    if (String(instruction).trim().length > 200) {
        return res.status(400).json({ success: false, message: '修改指令不能超过200个字符' })
    }

    // 无完整行程 → 400：参数校验放在 HTTP 边界（与 validatePlanParams 同一层）。
    // 旧会话（Phase 11 前只存概要）也走这里——客户端据此提示"先规划一次"
    const session = await stateManager.getSession(sessionId)
    if (!session?.tripPlan?.plan) {
        return res.status(400).json({ success: false, message: '该会话没有可修改的行程（请先规划一次）' })
    }

    const responseStream = createResponseStream(res)
    try {
        responseStream.send({ type: 'start', city: session.tripPlan.city })
        const { plan, usage } = await travelService.refine(
            sessionId, String(instruction).trim(),
            (event) => responseStream.send(event)
        )
        responseStream.done({
            sessionId,
            plan,
            usage
        })
    } catch (error) {
        // 流已建立后出错（图节点抛错 / 校验耗尽）：通过 SSE error 事件结束
        console.error('修改行程错误：', error)
        responseStream.error(error)
    }
}))

router.post('/chat', asyncHandler(async (req, res) => {
    const { message, sessionId } = req.body
    if(!message) {
        return res.status(400).json({
            success:false,
            message:'缺少必要参数'
        })
    }
    if (String(message).trim().length > 1000) {
        return res.status(400).json({ success: false, message: '消息不能超过1000个字符' })
    }

    // 会话：不存在则创建；客户端用 done 事件里的 sessionId 记住它
    const session = await stateManager.ensureSession(sessionId)

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
        responseStream.error(error)
    }
}))

export default router
