import { test } from 'node:test'
import assert from 'node:assert/strict'
import 'dotenv/config.js'
import { AIMessage } from '@langchain/core/messages'
import TravelService from '../services/travelService.js'

// plan-then-execute + Reflection 的确定性测试：stub LLM 模拟
// "大纲 OK → 完整行程超预算 → 校验失败 → re-plan 修正 → 通过" 的完整决策链。

const outlineJson = JSON.stringify({
    city: '杭州',
    days: 1,
    totalBudget: 800,
    dailyOutline: [{ day: 1, theme: '经典一日', spots: ['西湖'] }]
})

// 超预算的行程：totalBudget 1500，用户预算 800
const overBudgetPlan = JSON.stringify({
    city: '杭州',
    days: 1,
    totalBudget: 1500,
    dailyItinerary: [{ day: 1, date: '第1天', morning: { spot: '西湖', duration: '约4小时', ticket: '免费', transportation: '地铁', description: '世界文化遗产。' } }],
    budgetBreakdown: { accommodation: 600, food: 400, transportation: 200, tickets: 0, other: 300 }
})

// 修正后的行程：totalBudget 780，明细合计 780
const fixedPlan = JSON.stringify({
    city: '杭州',
    days: 1,
    totalBudget: 780,
    dailyItinerary: [{ day: 1, date: '第1天', morning: { spot: '西湖', duration: '约4小时', ticket: '免费', transportation: '地铁', description: '世界文化遗产。' } }],
    budgetBreakdown: { accommodation: 300, food: 200, transportation: 100, tickets: 0, other: 180 }
})

// 构造 TravelService，注入 stub：
// - toolLlm：第 1 轮请求工具，第 2 轮停止
// - structuredLlm：按"答案阶段"调用序列返回大纲/完整行程
function makeService(answerSequence) {
    const service = new TravelService()

    let toolCalls = 0
    service.toolLlm = {
        invoke: async () => {
            toolCalls++
            if (toolCalls === 1) {
                return new AIMessage({ content: '', tool_calls: [{ name: 'get_weather', args: { city: '杭州' }, id: 'c1' }] })
            }
            return new AIMessage({ content: '信息已足够。' })
        }
    }
    service.toolLlm.bindTools = () => service.toolLlm

    let answerCalls = 0
    service.structuredLlm = {
        invoke: async () => {
            const content = answerSequence[Math.min(answerCalls, answerSequence.length - 1)]
            answerCalls++
            return { content }
        }
    }
    return service
}

test('校验失败 → re-plan 一次 → 修复成功', async () => {
    // 答案序列：大纲 OK → 超预算行程 → 修正后行程
    const service = makeService([outlineJson, overBudgetPlan, fixedPlan])
    const plan = await service.recommend('杭州', 800, 1)
    assert.equal(plan.totalBudget, 780)
})

test('re-plan 后仍不通过 → 抛明确错误（不无限重试）', async () => {
    // 答案序列：大纲 OK → 超预算行程 → 还是超预算行程
    const service = makeService([outlineJson, overBudgetPlan, overBudgetPlan])
    await assert.rejects(
        () => service.recommend('杭州', 800, 1),
        /行程校验失败/
    )
})

test('大纲生成失败 → 降级跳过规划，直接生成行程', async () => {
    // 答案序列：两次坏大纲 → 合法行程
    const service = makeService(['这不是大纲', '也不是大纲', fixedPlan])
    const plan = await service.recommend('杭州', 800, 1)
    assert.equal(plan.totalBudget, 780)
})
