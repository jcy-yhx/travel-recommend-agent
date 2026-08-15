import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRateLimiter } from '../middleware/rateLimiter.js'
import { sumMessagesUsage, estimateCost } from '../utils/tokenStats.js'

// Hardening 组件的确定性测试：限流器 + token 统计。

// ---------- rateLimiter ----------

// 模拟 req/res 的轻量对象
function makeReq(ip) {
    return { ip, socket: { remoteAddress: ip } }
}
function makeRes() {
    let statusCode = 200
    let body = null
    return {
        status(code) { statusCode = code; return this },
        json(data) { body = data; return this },
        getStatus: () => statusCode,
        getBody: () => body
    }
}

test('窗口内超过 max 次返回 429', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 })
    const req = makeReq('1.1.1.1')
    let last

    for (let i = 0; i < 3; i++) {
        const res = makeRes()
        limiter(req, res, () => {})
        assert.equal(res.getStatus(), 200)
    }
    // 第 4 次超限
    const res = makeRes()
    limiter(req, res, () => {})
    last = res.getStatus()
    assert.equal(last, 429)
    assert.match(res.getBody().message, /频繁/)
})

test('不同 IP 互不影响', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 })
    const resA = makeRes()
    limiter(makeReq('1.1.1.1'), resA, () => {})
    const resB = makeRes()
    limiter(makeReq('2.2.2.2'), resB, () => {})
    assert.equal(resA.getStatus(), 200)
    assert.equal(resB.getStatus(), 200)
})

test('窗口过期后重新放行（滑动窗口）', () => {
    const limiter = createRateLimiter({ windowMs: 10, max: 1 })   // 10ms 窗口
    const req = makeReq('3.3.3.3')
    const first = makeRes()
    limiter(req, first, () => {})
    assert.equal(first.getStatus(), 200)
    // 等窗口过期
    return new Promise(resolve => setTimeout(() => {
        const second = makeRes()
        limiter(req, second, () => {})
        assert.equal(second.getStatus(), 200)
        resolve()
    }, 20))
})

// ---------- tokenStats ----------

test('sumMessagesUsage 汇总 usage_metadata', () => {
    const messages = [
        { usage_metadata: { input_tokens: 100, output_tokens: 50 } },
        { usage_metadata: { input_tokens: 200, output_tokens: 80 } },
        { usage_metadata: { input_tokens: 300, output_tokens: 120 } },
        { content: '无 usage 的消息（如 SystemMessage）' }
    ]
    const usage = sumMessagesUsage(messages)
    assert.equal(usage.inputTokens, 600)
    assert.equal(usage.outputTokens, 250)
})

test('estimateCost 按单价估算', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 }
    const cost = estimateCost(usage, { inputPricePerM: 0.3, outputPricePerM: 1.2 })
    assert.equal(cost, 1.5)
})
