import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { StateManager, MAX_HISTORY } from '../services/stateManager.js'

// StateManager 的确定性测试：用临时文件路径，不污染仓库运行时数据

function makeTempManager() {
    const file = join(tmpdir(), `travel-test-sessions-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    return { manager: new StateManager(file), file }
}

test('ensureSession 创建新会话并返回稳定 ID', () => {
    const { manager } = makeTempManager()
    const session = manager.ensureSession()
    assert.ok(session.sessionId)
    // 再次用同一 ID 获取，返回同一个会话
    assert.equal(manager.ensureSession(session.sessionId), session)
})

test('appendMessage 累积历史并写盘', () => {
    const { manager, file } = makeTempManager()
    const session = manager.ensureSession('test-1')
    manager.appendMessage('test-1', 'user', '你好')
    manager.appendMessage('test-1', 'assistant', '你好呀')
    assert.equal(session.history.length, 2)
    assert.equal(session.history[0].role, 'user')

    // 从磁盘重新加载，历史仍在
    const reloaded = new StateManager(file)
    assert.equal(reloaded.getSession('test-1').history.length, 2)
    rmSync(file, { force: true })
})

test('历史裁剪：超过 MAX_HISTORY 只保留最近 N 条', () => {
    const { manager } = makeTempManager()
    manager.ensureSession('test-trim')
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
        manager.appendMessage('test-trim', 'user', `消息 ${i}`)
    }
    const session = manager.getSession('test-trim')
    assert.equal(session.history.length, MAX_HISTORY)
    // 保留的是最新的
    assert.equal(session.history[session.history.length - 1].content, `消息 ${MAX_HISTORY + 4}`)
    assert.equal(session.history[0].content, '消息 5')
})

test('setTripPlan 保存行程草案', () => {
    const { manager } = makeTempManager()
    manager.ensureSession('test-plan')
    manager.setTripPlan('test-plan', { city: '杭州', days: 2, totalBudget: 1000 })
    const tripPlan = manager.getSession('test-plan').tripPlan
    assert.equal(tripPlan.city, '杭州')
    assert.equal(tripPlan.days, 2)
})

test('未知 sessionId 的 getSession 返回 null，appendMessage 返回 null', () => {
    const { manager } = makeTempManager()
    assert.equal(manager.getSession('ghost'), null)
    assert.equal(manager.appendMessage('ghost', 'user', 'hi'), null)
})

test('服务重启恢复：新实例从同一文件恢复会话（持久化）', () => {
    const { manager, file } = makeTempManager()
    manager.ensureSession('survive-restart')
    manager.appendMessage('survive-restart', 'user', '重启前的消息')

    // 模拟进程重启：新建实例从同一文件加载
    const restarted = new StateManager(file)
    const session = restarted.getSession('survive-restart')
    assert.ok(session)
    assert.equal(session.history[0].content, '重启前的消息')
    rmSync(file, { force: true })
})
