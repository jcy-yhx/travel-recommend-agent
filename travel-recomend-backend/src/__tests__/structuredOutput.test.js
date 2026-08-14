import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractJson } from '../utils/extractJson.js'
import { TravelPlanSchema } from '../services/travelPlanSchema.js'

// Structured Output 的确定性单元测试。
// 不调用 LLM（不消耗 API 配额），覆盖 extractJson 与 schema 校验的
// 成功路径和各种失败路径——失败路径正是触发重试循环的条件。

// 一段合法的行程数据（各失败用例会在此基础上破坏）
const validPlan = {
    city: '北京',
    days: 1,
    totalBudget: 800,
    dailyItinerary: [
        {
            day: 1,
            date: '第1天',
            morning: {
                spot: '天安门广场和故宫',
                duration: '约4小时',
                ticket: '60元',
                transportation: '地铁1号线',
                description: '天安门广场和故宫是北京的标志性景点。'
            }
        }
    ],
    budgetBreakdown: {
        accommodation: 300,
        food: 200,
        transportation: 100,
        tickets: 60,
        other: 140
    },
    tips: ['提前预约门票'],
    warnings: ['注意防晒']
}

// ---------- extractJson ----------

test('提取 ```json 围栏中的 JSON', () => {
    const text = '以下是行程：\n```json\n' + JSON.stringify(validPlan) + '\n```\n希望有帮助！'
    const json = JSON.parse(extractJson(text))
    assert.equal(json.city, '北京')
})

test('提取无围栏的裸 JSON（前后有说明文字）', () => {
    const text = '好的，这是为您规划的行程：\n' + JSON.stringify(validPlan) + '\n祝您旅途愉快！'
    const json = JSON.parse(extractJson(text))
    assert.equal(json.city, '北京')
})

test('模型输出中完全没有 JSON 时抛错（触发重试）', () => {
    assert.throws(
        () => extractJson('抱歉，我无法生成行程，请稍后再试。'),
        /找不到 JSON 对象/
    )
})

// ---------- TravelPlanSchema ----------

test('合法行程通过校验', () => {
    const result = TravelPlanSchema.parse(validPlan)
    assert.equal(result.city, '北京')
})

test('缺少 dailyItinerary 字段时校验失败（触发重试）', () => {
    const bad = { ...validPlan }
    delete bad.dailyItinerary
    const result = TravelPlanSchema.safeParse(bad)
    assert.equal(result.success, false)
})

test('ticket 是数字（schema 要求字符串）时校验失败（触发重试）', () => {
    const bad = JSON.parse(JSON.stringify(validPlan))
    bad.dailyItinerary[0].morning.ticket = 60
    const result = TravelPlanSchema.safeParse(bad)
    assert.equal(result.success, false)
})

test('预算字段是字符串（schema 要求数字）时校验失败（触发重试）', () => {
    const bad = JSON.parse(JSON.stringify(validPlan))
    bad.totalBudget = '800'
    const result = TravelPlanSchema.safeParse(bad)
    assert.equal(result.success, false)
})
