import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UpstreamServiceError, withRetry } from '../utils/retry.js'

test('瞬时网络错误失败一次后重试成功', async () => {
    let calls = 0
    const result = await withRetry(async () => {
        calls++
        if (calls === 1) {
            const error = new Error('timeout')
            error.code = 'ETIMEDOUT'
            throw error
        }
        return 'ok'
    }, { delayMs: 0 })

    assert.equal(result, 'ok')
    assert.equal(calls, 2)
})

test('确定性 4xx 错误不重试', async () => {
    let calls = 0
    await assert.rejects(() => withRetry(async () => {
        calls++
        const error = new Error('bad request')
        error.status = 400
        throw error
    }, { delayMs: 0 }))
    assert.equal(calls, 1)
})

test('LangChain 包装的 TimeoutError 会重试', async () => {
    let calls = 0
    const result = await withRetry(async () => {
        calls++
        if (calls === 1) {
            const error = new Error('Request timed out.')
            error.cause = { name: 'TimeoutError' }
            throw error
        }
        return 'ok'
    }, { delayMs: 0 })
    assert.equal(result, 'ok')
    assert.equal(calls, 2)
})

test('上游错误具有 503、错误码和可重试标识', () => {
    const error = new UpstreamServiceError('LLM', new Error('timeout'))
    assert.equal(error.status, 503)
    assert.equal(error.code, 'LLM_UNAVAILABLE')
    assert.equal(error.retryable, true)
})
