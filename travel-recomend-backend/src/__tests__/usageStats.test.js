import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { StateManager } from '../services/stateManager.js'

// 成本统计的确定性测试：recordUsage 累计 / getStats 聚合 / 磁盘持久化。

function makeTempManager() {
    const file = join(tmpdir(), `travel-test-stats-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    return { manager: new StateManager(file), file }
}

test('recordUsage 累计单会话多次请求', () => {
    const { manager } = makeTempManager()
    manager.ensureSession('s1')
    manager.recordUsage('s1', 'recommend', { inputTokens: 1000, outputTokens: 500 })
    manager.recordUsage('s1', 'recommend', { inputTokens: 2000, outputTokens: 800 })

    const stats = manager.getStats()
    assert.equal(stats.requestCount, 2)
    assert.equal(stats.inputTokens, 3000)
    assert.equal(stats.outputTokens, 1300)
})

test('getStats 跨会话聚合 + 估算成本', () => {
    const { manager } = makeTempManager()
    manager.ensureSession('s1')
    manager.ensureSession('s2')
    manager.recordUsage('s1', 'recommend', { inputTokens: 5000, outputTokens: 2000 })
    manager.recordUsage('s2', 'recommend', { inputTokens: 5000, outputTokens: 2000 })

    const stats = manager.getStats()
    assert.equal(stats.sessionCount, 2)
    assert.equal(stats.requestCount, 2)
    assert.equal(stats.inputTokens, 10000)
    // 1万输入 + 1万输出按默认单价：0.01 * 0.3 + 0.01 * 1.2 = 0.015
    assert.ok(stats.estimatedCost > 0)
})

test('usageLog 随会话持久化，重启后统计仍在', () => {
    const { manager, file } = makeTempManager()
    manager.ensureSession('s1')
    manager.recordUsage('s1', 'recommend', { inputTokens: 1234, outputTokens: 567 })

    const restarted = new StateManager(file)
    const stats = restarted.getStats()
    assert.equal(stats.inputTokens, 1234)
    assert.equal(stats.outputTokens, 567)
    rmSync(file, { force: true })
})

test('recordUsage 对未知会话安全返回 null', () => {
    const { manager } = makeTempManager()
    assert.equal(manager.recordUsage('ghost', 'recommend', { inputTokens: 1, outputTokens: 1 }), null)
})
