import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shapeNodeEvent } from '../utils/traceEvents.js'

// 轨迹事件整形层的确定性测试：喂伪造的节点增量，断言整形结果。
// 不调用 LLM、不需要真实 LangGraph 图。

test('agent 节点：有工具调用时输出轮次与调用清单', () => {
    const event = shapeNodeEvent('agent', {
        agentIterations: 2,
        messages: [{ tool_calls: [
            { name: 'get_weather', args: { city: '北京' } },
            { name: 'search_attractions', args: { query: '故宫' } }
        ] }]
    }, 3)
    assert.equal(event.node, 'agent')
    assert.equal(event.seq, 3)
    assert.equal(event.data.iteration, 2)
    assert.equal(event.data.stopped, false)
    assert.deepEqual(event.data.toolCalls.map(t => t.name), ['get_weather', 'search_attractions'])
})

test('agent 节点：无工具调用 = 自主终止', () => {
    const event = shapeNodeEvent('agent', { agentIterations: 3, messages: [{}] }, 4)
    assert.equal(event.data.stopped, true)
    assert.equal(event.data.toolCalls.length, 0)
})

test('tools 节点：解析结果并标记 error，超长内容截断', () => {
    const longContent = JSON.stringify({ results: [{ name: 'x'.repeat(500) }] })
    const event = shapeNodeEvent('tools', { messages: [
        { content: JSON.stringify({ city: '北京', condition: '晴' }) },
        { content: JSON.stringify({ error: '未知工具' }) },
        { content: longContent }
    ] }, 5)
    assert.equal(event.data.results.length, 3)
    assert.equal(event.data.results[0].hasError, false)
    assert.equal(event.data.results[1].hasError, true)
    assert.ok(event.data.results[2].preview.length <= 210)  // 200 + 省略号余量
})

test('planner 节点：成功与降级两种形态', () => {
    const ok = shapeNodeEvent('planner', { outline: {} }, 6)
    assert.equal(ok.data.ok, true)
    assert.equal(ok.data.degraded, false)
    const degraded = shapeNodeEvent('planner', { outline: null }, 7)
    assert.equal(degraded.data.ok, false)
    assert.equal(degraded.data.degraded, true)
})

test('validator 节点：通过与失败', () => {
    const pass = shapeNodeEvent('validator', { validationErrors: null }, 8)
    assert.equal(pass.data.valid, true)
    const fail = shapeNodeEvent('validator', { validationErrors: ['总预算超出用户预算'] }, 9)
    assert.equal(fail.data.valid, false)
    assert.equal(fail.data.errors[0], '总预算超出用户预算')
})

test('replan_feedback 节点：携带校验错误', () => {
    const event = shapeNodeEvent('replan_feedback', { validationErrors: ['预算明细偏差超过 10%'] }, 10)
    assert.equal(event.node, 'replan_feedback')
    assert.equal(event.data.errors.length, 1)
})

test('未知节点静默忽略（返回 null）', () => {
    assert.equal(shapeNodeEvent('future_node', {}, 11), null)
})
