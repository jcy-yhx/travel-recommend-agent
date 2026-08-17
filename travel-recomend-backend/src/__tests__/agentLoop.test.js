import { test } from 'node:test'
import assert from 'node:assert/strict'
import 'dotenv/config.js' // TravelService 构造时读取 .env 配置（只构造，不调用真实 API）
import { AIMessage } from '@langchain/core/messages'
import TravelService from '../services/travelService.js'

// Agent Loop 的确定性测试：用 stub LLM 模拟模型的逐轮决策，验证
// 1) 多轮循环：模型连续请求工具 → 每轮执行 → 直到停止
// 2) 终止兜底：模型无限请求工具 → max_iter 触发，抛明确错误
// 不调用真实 API，不消耗配额。

const validPlan = JSON.stringify({
    city: '杭州',
    days: 1,
    totalBudget: 800,
    dailyItinerary: [{
        day: 1,
        date: '第1天',
        morning: {
            spot: '西湖',
            duration: '约4小时',
            ticket: '免费',
            transportation: '地铁1号线',
            description: '世界文化遗产。'
        }
    }],
    budgetBreakdown: { accommodation: 300, food: 200, transportation: 100, tickets: 0, other: 200 },
    tips: ['测试提示'],
    warnings: ['测试警告']
})

// 构造一个 TravelService 并注入 stub LLM。
// structuredLlm（答案阶段）区分两种调用：
// - prompt 里带"大纲" → 返回行程大纲（Phase 06 planner 步骤）
// - 其他 → 返回完整行程 JSON
// toolLlm 的行为由 behavior 函数逐轮控制。
const outlineJson = JSON.stringify({
    city: '杭州',
    days: 1,
    totalBudget: 800,
    dailyOutline: [{ day: 1, theme: '经典一日', spots: ['西湖'] }]
})

function makeServiceWithStub(toolLlmBehavior, answerLlmContent) {
    const service = new TravelService()

    let toolCalls = 0
    service.toolLlm = {
        invoke: async () => toolLlmBehavior(toolCalls++)
    }
    service.toolLlm.bindTools = () => service.toolLlm

    let answerCalls = 0
    service.structuredLlm = {
        invoke: async (messages) => {
            answerCalls++
            const lastHuman = [...messages].reverse().find(m => m.constructor.name === 'HumanMessage')
            if (lastHuman?.content?.includes('大纲')) {
                return { content: outlineJson }
            }
            return { content: answerLlmContent ?? validPlan }
        }
    }
    return service
}

function toolCallMsg(toolCalls) {
    return new AIMessage({ content: '', tool_calls: toolCalls })
}

test('工具调用后模型自主停止，进入规划阶段', async () => {
    const service = makeServiceWithStub((callIndex) => {
        // 第 1 轮：查天气；第 2 轮：停止（无 tool_calls）
        if (callIndex === 0) {
            return toolCallMsg([{ name: 'get_weather', args: { city: '杭州' }, id: 'c1' }])
        }
        return new AIMessage({ content: '信息已足够。' })
    })

    const plan = await service.recommend('杭州', 800, 1)

    // 循环正确终止，最终答案通过校验
    assert.equal(plan.city, '杭州')
})

test('max_iter 兜底：模型无限请求工具 → 抛明确错误而不是无限烧 token', async () => {
    const service = makeServiceWithStub(() =>
        // 未知工具不占天气/景点配额，仍由 max_iter 兜底拦截。
        toolCallMsg([{ name: 'unknown_tool', args: {}, id: 'c_loop' }])
    )

    await assert.rejects(
        () => service.recommend('杭州', 800, 1),
        /最大迭代次数/
    )
})

test('工具执行失败后循环继续：模型下一轮换参数重试', async () => {
    // 第 1 轮：未知工具（返回 error）→ 第 2 轮模型换为天气工具 → 第 3 轮停止
    const service = makeServiceWithStub((callIndex) => {
        if (callIndex === 0) {
            return toolCallMsg([{ name: 'unknown_tool', args: {}, id: 'c1' }])
        }
        if (callIndex === 1) {
            return toolCallMsg([{ name: 'get_weather', args: { city: '杭州' }, id: 'c2' }])
        }
        return new AIMessage({ content: '重试成功。' })
    })

    const plan = await service.recommend('杭州', 800, 1)
    assert.equal(plan.city, '杭州')
})

test('天气额度耗尽后强制进入规划，不会因重复工具调用达到 max_iter', async () => {
    let agentCalls = 0
    const service = makeServiceWithStub(() => {
        agentCalls++
        return toolCallMsg([{ name: 'get_weather', args: { city: '杭州' }, id: `c_${agentCalls}` }])
    })

    const plan = await service.recommend('杭州', 800, 1)
    assert.equal(plan.city, '杭州')
    // 第 1 次实际查天气；第 2 次请求被硬额度拦截后直接进 planner。
    assert.equal(agentCalls, 2)
})
