import { test } from 'node:test'
import assert from 'node:assert/strict'
import 'dotenv/config.js'
import { AIMessage } from '@langchain/core/messages'
import TravelService from '../services/travelService.js'

// recommendStream 的确定性测试：stub LLM，断言
// 1) 事件序列覆盖 agent→tools→planner→executor→validator
// 2) 最终返回 plan（stub 消息无 usage_metadata，usage 为 0——断言形状即可）
// 3) 节点抛错时 stream 向上抛出（路由层转 SSE error）

const validPlan = JSON.stringify({
    city: '杭州', days: 1, totalBudget: 800,
    dailyItinerary: [{ day: 1, date: '第1天', morning: {
        spot: '西湖', duration: '约4小时', ticket: '免费',
        transportation: '地铁1号线', description: '世界文化遗产。'
    }}],
    budgetBreakdown: { accommodation: 300, food: 200, transportation: 100, tickets: 0, other: 200 },
    tips: ['测试提示'], warnings: ['测试警告']
})

const outlineJson = JSON.stringify({
    city: '杭州', days: 1, totalBudget: 800,
    dailyOutline: [{ day: 1, theme: '经典一日', spots: ['西湖'] }]
})

function makeService() {
    const service = new TravelService()

    let toolCalls = 0
    service.toolLlm = {
        invoke: async () => {
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

    let answerCalls = 0
    service.structuredLlm = {
        invoke: async (messages) => {
            answerCalls++
            const lastHuman = [...messages].reverse().find(m => m.constructor.name === 'HumanMessage')
            if (lastHuman?.content?.includes('大纲')) return { content: outlineJson }
            return { content: validPlan }
        }
    }
    return service
}

test('事件序列完整覆盖核心节点，最终返回 plan 和 usage', async () => {
    const service = makeService()
    const events = []
    const { plan, usage } = await service.recommendStream('杭州', 800, 1, null, (e) => events.push(e))

    // 事件序列（updates 模式按节点完成顺序）
    const nodeNames = events.map(e => e.node)
    assert.deepEqual(nodeNames, ['agent', 'tools', 'agent', 'planner', 'executor', 'validator'])

    // 关键事件内容抽查
    const firstAgent = events.find(e => e.node === 'agent')
    assert.equal(firstAgent.data.stopped, false)
    assert.deepEqual(firstAgent.data.toolCalls.map(t => t.name), ['get_weather'])
    const secondAgent = events[2]
    assert.equal(secondAgent.data.stopped, true)   // 自主终止
    const validator = events[5]
    assert.equal(validator.data.valid, true)

    // 最终结果
    assert.equal(plan.city, '杭州')
    assert.equal(typeof usage.inputTokens, 'number')
    assert.equal(typeof usage.estimatedCost, 'number')
})

test('图节点抛错（max_iter 兜底）时 stream 向上抛出', async () => {
    const service = makeService()
    // toolLlm 永远返回未知工具调用 → 不占已知工具额度，5 轮后仍由 fail_max_iter 拦截
    service.toolLlm = {
        invoke: async () => new AIMessage({ content: '', tool_calls: [
            { name: 'unknown_tool', args: {}, id: 'c_loop' }
        ] })
    }
    service.toolLlm.bindTools = () => service.toolLlm

    await assert.rejects(
        () => service.recommendStream('杭州', 800, 1, null, () => {}),
        /最大迭代次数/
    )
})
