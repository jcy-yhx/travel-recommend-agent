import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePlan, BUDGET_TOLERANCE } from '../services/planValidator.js'

// 行程语义校验器的确定性测试：不调用 LLM。

const userConstraints = { budget: 1000, days: 2 }

function makePlan(overrides = {}) {
    return {
        city: '杭州',
        days: 2,
        totalBudget: 1000,
        dailyItinerary: [
            { day: 1, date: '第1天', morning: { spot: '西湖', duration: '约4小时', ticket: '免费', transportation: '地铁', description: '世界文化遗产。' } },
            { day: 2, date: '第2天', morning: { spot: '灵隐寺', duration: '约2小时', ticket: '75元', transportation: '公交', description: '千年古刹。' } }
        ],
        budgetBreakdown: { accommodation: 400, food: 300, transportation: 150, tickets: 75, other: 75 },
        ...overrides
    }
}

test('合法行程通过校验', () => {
    const result = validatePlan(userConstraints, makePlan())
    assert.equal(result.valid, true)
    assert.equal(result.errors.length, 0)
})

test('总预算超出容差时校验失败', () => {
    const result = validatePlan(userConstraints, makePlan({ totalBudget: 1500 }))
    assert.equal(result.valid, false)
    assert.ok(result.errors.some(e => e.includes('超出用户预算')))
})

test('总预算在容差内（+10%）可以通过', () => {
    const limit = Math.floor(1000 * (1 + BUDGET_TOLERANCE))
    const result = validatePlan(userConstraints, makePlan({ totalBudget: limit }))
    assert.equal(result.valid, true)
})

test('预算明细求和与总预算偏差过大时校验失败', () => {
    // 明细合计 1000，总预算改成 2000 → 偏差 50%
    const result = validatePlan(userConstraints, makePlan({ totalBudget: 2000 }))
    // 这个用例同时触发"超预算"，因此单独构造一个不超预算但明细不符的
    const plan2 = makePlan({ totalBudget: 900, budgetBreakdown: { accommodation: 100, food: 100, transportation: 100, tickets: 100, other: 100 } })
    const result2 = validatePlan(userConstraints, plan2)
    assert.equal(result2.valid, false)
    assert.ok(result2.errors.some(e => e.includes('偏差超过 10%')))
    assert.equal(result.valid, false)
})

test('缺少预算明细时校验失败', () => {
    const plan = makePlan()
    delete plan.budgetBreakdown
    const result = validatePlan(userConstraints, plan)
    assert.equal(result.valid, false)
    assert.ok(result.errors.some(e => e.includes('缺少预算分配明细')))
})

test('行程天数与用户要求不一致时校验失败', () => {
    const result = validatePlan(userConstraints, makePlan({ days: 3 }))
    assert.equal(result.valid, false)
    assert.ok(result.errors.some(e => e.includes('与用户要求')))
})

test('行程条目数与天数不一致时校验失败', () => {
    // days=2 但只有 1 天的行程条目
    const plan = makePlan()
    plan.dailyItinerary = plan.dailyItinerary.slice(0, 1)
    const result = validatePlan(userConstraints, plan)
    assert.equal(result.valid, false)
    assert.ok(result.errors.some(e => e.includes('行程条目数')))
})

test('某天没有任何行程安排时校验失败', () => {
    const plan = makePlan()
    plan.dailyItinerary[1] = { day: 2, date: '第2天' }
    const result = validatePlan(userConstraints, plan)
    assert.equal(result.valid, false)
    assert.ok(result.errors.some(e => e.includes('没有任何行程安排')))
})

test('多个问题同时存在时全部报出', () => {
    const plan = makePlan({ days: 5, totalBudget: 3000 })
    const result = validatePlan(userConstraints, plan)
    assert.equal(result.valid, false)
    assert.ok(result.errors.length >= 3)
})
