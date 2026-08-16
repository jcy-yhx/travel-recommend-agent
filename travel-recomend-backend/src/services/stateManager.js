import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { estimateCost } from '../utils/tokenStats.js'

const DEFAULT_SESSIONS_FILE = new URL('../data/sessions.json', import.meta.url)

// 对话历史上限：只保留最近 N 条，防止上下文无限增长（token 成本线性上升）
export const MAX_HISTORY = 20

// StateManager：会话状态管理。
// 设计（本阶段刻意克制）：
// - 内存 Map：请求间快速读写（sessionId → state）
// - JSON 文件：进程重启后恢复会话（持久化）
// - 不做数据库/Redis：学习项目规模下 JSON 文件足够；生产演进路径写在文档里
//
// State 的语义（面试区分点）：
// - State（本类）：单次任务/会话内的运行状态——对话历史、行程草案
// - Memory（长期记忆）：跨会话的用户偏好（如"喜欢徒步"），本阶段只做概念，
//   真正落地需要用户画像与检索，属于面试后可做内容
export class StateManager {
    constructor(filePath = DEFAULT_SESSIONS_FILE) {
        this.filePath = filePath
        this.sessions = new Map()
        this.loadFromDisk()
    }

    // 进程启动时从磁盘恢复会话（服务重启不丢状态）
    loadFromDisk() {
        if (!existsSync(this.filePath)) return
        try {
            const data = JSON.parse(readFileSync(this.filePath, 'utf-8'))
            for (const [id, state] of data) {
                this.sessions.set(id, state)
            }
            console.log(`[StateManager] 从磁盘恢复 ${this.sessions.size} 个会话`)
        } catch (error) {
            console.error('[StateManager] 磁盘恢复失败：', error.message)
        }
    }

    // 同步写盘：规模小、频率低，够用；生产应异步批量写 + 数据库
    persist() {
        try {
            writeFileSync(this.filePath, JSON.stringify([...this.sessions.entries()], null, 2))
        } catch (error) {
            console.error('[StateManager] 持久化失败：', error.message)
        }
    }

    // 取会话；不存在时创建。传入已有 sessionId 但服务端已重启丢失时，按新会话创建
    ensureSession(sessionId) {
        if (sessionId && this.sessions.has(sessionId)) {
            return this.sessions.get(sessionId)
        }
        const id = sessionId || randomUUID()
        const session = {
            sessionId: id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            history: [],          // [{ role: 'user'|'assistant', content, at }]
            tripPlan: null        // { city, days, totalBudget, updatedAt }
        }
        this.sessions.set(id, session)
        this.persist()
        return session
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId) ?? null
    }

    appendMessage(sessionId, role, content) {
        const session = this.sessions.get(sessionId)
        if (!session) return null
        session.history.push({ role, content, at: new Date().toISOString() })
        // 历史裁剪：超上限丢最旧的（滑窗策略）
        if (session.history.length > MAX_HISTORY) {
            session.history = session.history.slice(-MAX_HISTORY)
        }
        session.updatedAt = new Date().toISOString()
        this.persist()
        return session
    }

    // 保存行程草案：让 chat 能引用"用户刚才规划的行程"
    setTripPlan(sessionId, plan) {
        const session = this.sessions.get(sessionId)
        if (!session) return null
        session.tripPlan = {
            city: plan.city,
            days: plan.days,
            totalBudget: plan.totalBudget,
            updatedAt: new Date().toISOString()
        }
        session.updatedAt = new Date().toISOString()
        this.persist()
        return session
    }

    // 记录一次 LLM 规划请求的 token 用量（成本观测，Phase 08/10）
    recordUsage(sessionId, kind, usage) {
        const session = this.sessions.get(sessionId)
        if (!session) return null
        if (!session.usageLog) session.usageLog = []
        session.usageLog.push({
            at: new Date().toISOString(),
            kind,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0
        })
        this.persist()
        return session
    }

    // 全局成本统计：聚合所有会话的 usageLog（纯内存读，不调 LLM）
    getStats() {
        let requestCount = 0
        let inputTokens = 0
        let outputTokens = 0
        for (const session of this.sessions.values()) {
            for (const entry of session.usageLog ?? []) {
                requestCount++
                inputTokens += entry.inputTokens
                outputTokens += entry.outputTokens
            }
        }
        const usage = { inputTokens, outputTokens }
        return {
            sessionCount: this.sessions.size,
            requestCount,
            inputTokens,
            outputTokens,
            estimatedCost: estimateCost(usage)
        }
    }
}

export const stateManager = new StateManager()
