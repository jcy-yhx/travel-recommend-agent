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
// structuredLlm（答案轮）返回合法行程 JSON；
// toolLlm 的行为由 behavior 函数逐轮控制。
function makeServiceWithStub(toolLlmBehavior, answerLlmContent) {
    const service = new TravelService()

    let toolCalls = 0
    service.toolLlm = {
        invoke: async () => toolLlmBehavior(toolCalls++)
    }
    service.toolLlm.bindTools = () => service.toolLlm

    let answerCalls = 0
    service.structuredLlm = {
        invoke: async () => {
            answerCalls++
            return { content: answerLlmContent ?? validPlan }
        }
    }
    return service
}

function toolCallMsg(toolCalls) {
    return new AIMessage({ content: '', tool_calls: toolCalls })
}

test('多轮循环：模型连续 2 轮请求工具后自主停止', async () => {
    const service = makeServiceWithStub((callIndex) => {
        // 第 1 轮：查天气；第 2 轮：查景点；第 3 轮：停止（无 tool_calls）
        if (callIndex === 0) {
            return toolCallMsg([{ name: 'get_weather', args: { city: '杭州' }, id: 'c1' }])
        }
        if (callIndex === 1) {
            return toolCallMsg([{ name: 'search_attractions', args: { query: '杭州' }, id: 'c2' }])
        }
        return new AIMessage({ content: '信息已足够。' })
    })

    const plan = await service.recommend('杭州', 800, 1)

    // 循环正确终止，最终答案通过校验
    assert.equal(plan.city, '杭州')
})

test('max_iter 兜底：模型无限请求工具 → 抛明确错误而不是无限烧 token', async () => {
    const service = makeServiceWithStub(() =>
        toolCallMsg([{ name: 'get_weather', args: { city: '杭州' }, id: 'c_loop' }])
    )

    await assert.rejects(
        () => service.recommend('杭州', 800, 1),
        /最大迭代次数/
    )
})

test('工具执行失败后循环继续：模型下一轮换参数重试', async () => {
    // 第 1 轮：查询未知城市（工具返回 error 字段）→ 第 2 轮模型"换一个城市"查询 → 第 3 轮停止
    const service = makeServiceWithStub((callIndex) => {
        if (callIndex === 0) {
            return toolCallMsg([{ name: 'get_weather', args: { city: '不存在的城市' }, id: 'c1' }])
        }
        if (callIndex === 1) {
            return toolCallMsg([{ name: 'get_weather', args: { city: '杭州' }, id: 'c2' }])
        }
        return new AIMessage({ content: '重试成功。' })
    })

    const plan = await service.recommend('杭州', 800, 1)
    assert.equal(plan.city, '杭州')
})
