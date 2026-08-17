import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import 'dotenv/config.js'
import { AIMessage } from '@langchain/core/messages'

// refine 的确定性测试：stub LLM 驱动重跑图，断言
// 1) 初始消息注入旧行程 JSON + 修改指令
// 2) 新行程写回会话（覆盖旧行程）
// 3) usage 按 'refine' 记账
// 4) 无完整行程的会话抛明确错误（路由层 400 的 service 兜底）

// 关键：stateManager 单例在模块加载时读取 SESSIONS_FILE 环境变量。
// 因此必须在 import travelService（其依赖链会加载单例）之前设置好，
// 用动态 import 控制加载时机，把测试会话写进临时文件。
const tempDir = mkdtempSync(join(tmpdir(), 'travel-refine-'))
process.env.SESSIONS_FILE = join(tempDir, 'sessions.json')
const { stateManager } = await import('../services/stateManager.js')
const { default: TravelService } = await import('../services/travelService.js')

const oldPlan = {
    city: '杭州', days: 1, totalBudget: 800,
    dailyItinerary: [{ day: 1, date: '第1天', morning: {
        spot: '西湖', duration: '约4小时', ticket: '免费',
        transportation: '地铁1号线', description: '世界文化遗产。'
    }}],
    budgetBreakdown: { accommodation: 300, food: 200, transportation: 100, tickets: 0, other: 200 },
    tips: ['旧提示'], warnings: ['旧警告']
}

// stub 返回的新行程：同城市/天数/预算（通过 validator），景点换成灵隐寺——证明行程真的被替换
const newPlan = {
    city: '杭州', days: 1, totalBudget: 800,
    dailyItinerary: [{ day: 1, date: '第1天', morning: {
        spot: '灵隐寺', duration: '约3小时', ticket: '45元',
        transportation: '公交车', description: '千年古刹。'
    }}],
    budgetBreakdown: { accommodation: 300, food: 200, transportation: 100, tickets: 45, other: 155 },
    tips: ['新提示'], warnings: ['新警告']
}

const outlineJson = JSON.stringify({
    city: '杭州', days: 1, totalBudget: 800,
    dailyOutline: [{ day: 1, theme: '古刹一日', spots: ['灵隐寺'] }]
})

function makeService() {
    const service = new TravelService()

    let capturedMessages = null
    let toolCalls = 0
    service.toolLlm = {
        invoke: async (messages) => {
            capturedMessages = messages
            toolCalls++
            if (toolCalls === 1) {
                return new AIMessage({ content: '', tool_calls: [
                    { name: 'get_weather', args: { city: '杭州' }, id: 'c1' }
                ] })
            }
            return new AIMessage({ content: '信息已足够。' })
        }
    }
    service.toolLlm.bindTools = () => service.toolLlm

    service.structuredLlm = {
        invoke: async (messages) => {
            const lastHuman = [...messages].reverse().find(m => m.constructor.name === 'HumanMessage')
            if (lastHuman?.content?.includes('大纲')) return { content: outlineJson }
            return { content: JSON.stringify(newPlan) }
        }
    }
    return { service, getCapturedMessages: () => capturedMessages }
}

test('refine 注入旧行程与修改指令，新行程写回会话并按 refine 记账', async () => {
    const { service, getCapturedMessages } = makeService()

    // 预置会话：已有完整行程
    stateManager.ensureSession('refine-1')
    stateManager.setTripPlan('refine-1', oldPlan)

    const events = []
    const { plan, usage } = await service.refine('refine-1', '把第二天改成西湖', (e) => events.push(e))

    // ① 初始消息注入：agent 节点收到的第一条 HumanMessage 含旧行程 JSON 与修改指令
    const messages = getCapturedMessages()
    const firstHuman = messages.find(m => m.constructor.name === 'HumanMessage')
    assert.ok(firstHuman.content.includes(JSON.stringify(oldPlan, null, 2)), '应注入完整旧行程 JSON')
    assert.ok(firstHuman.content.includes('把第二天改成西湖'), '应包含修改指令')
    assert.ok(firstHuman.content.includes('天数保持 1 天不变'), '应包含天数约束')

    // ② 事件序列：与 recommendStream 相同的节点轨迹（同一个图）
    const nodeNames = events.map(e => e.node)
    assert.deepEqual(nodeNames, ['agent', 'tools', 'agent', 'planner', 'executor', 'validator'])

    // ③ 新行程覆盖旧行程写回会话
    const tripPlan = stateManager.getSession('refine-1').tripPlan
    assert.equal(tripPlan.plan.dailyItinerary[0].morning.spot, '灵隐寺')
    assert.equal(plan.dailyItinerary[0].morning.spot, '灵隐寺')

    // ④ usage 按 'refine' 记账（getStats 里 requestCount 含本次）
    const lastUsage = stateManager.getSession('refine-1').usageLog.at(-1)
    assert.equal(lastUsage.kind, 'refine')
    assert.equal(typeof usage.inputTokens, 'number')
})

test('refine 强制重新 grounding：图仍先走工具轮（旧行程不能替代真实资料）', async () => {
    const { service, getCapturedMessages } = makeService()
    stateManager.ensureSession('refine-2')
    stateManager.setTripPlan('refine-2', oldPlan)

    const events = []
    await service.refine('refine-2', '把行程改得更省钱', (e) => events.push(e))

    // 第一轮 agent 事件必须带工具调用（图对 agent 首轮 tool_choice=required）
    const firstAgent = events.find(e => e.node === 'agent')
    assert.equal(firstAgent.data.stopped, false)
    assert.ok(firstAgent.data.toolCalls.length >= 1)
    // 且 system 提示仍含工具协议（SystemMessage 在 messages[0]）
    assert.ok(getCapturedMessages()[0].content.includes('search_attractions 调用达到 2 次后'))
})

test('无完整行程的会话 refine 抛明确错误', async () => {
    const { service } = makeService()

    // 完全没有行程
    stateManager.ensureSession('refine-none')
    await assert.rejects(
        () => service.refine('refine-none', '改一改', () => {}),
        /没有可修改的行程/
    )

    // Phase 11 前的旧格式：只有概要、没有完整 plan
    stateManager.ensureSession('refine-summary')
    const session = stateManager.getSession('refine-summary')
    session.tripPlan = { city: '成都', days: 1, totalBudget: 800, updatedAt: new Date().toISOString() }
    await assert.rejects(
        () => service.refine('refine-summary', '改一改', () => {}),
        /没有可修改的行程/
    )
})

test('refine 图节点抛错时向上传播（路由层转 SSE error）', async () => {
    const { service } = makeService()
    // 未知工具不占天气/景点额度，持续调用时仍由 5 轮 max_iter 兜底。
    service.toolLlm = {
        invoke: async () => new AIMessage({ content: '', tool_calls: [
            { name: 'unknown_tool', args: {}, id: 'c_loop' }
        ] })
    }
    service.toolLlm.bindTools = () => service.toolLlm

    stateManager.ensureSession('refine-loop')
    stateManager.setTripPlan('refine-loop', oldPlan)
    await assert.rejects(
        () => service.refine('refine-loop', '改一改', () => {}),
        /最大迭代次数/
    )
})

// 清理临时目录（node:test 文件进程结束时执行）
process.on('exit', () => rmSync(tempDir, { recursive: true, force: true }))
