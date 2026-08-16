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

test('setTripPlan 保存完整行程（Phase 11：refine 注入与 detail 恢复依赖）', () => {
    const { manager } = makeTempManager()
    manager.ensureSession('test-full-plan')
    const fullPlan = {
        city: '杭州', days: 2, totalBudget: 1500,
        dailyItinerary: [{ day: 1, date: '第1天' }],
        budgetBreakdown: { accommodation: 500, food: 400, transportation: 300, tickets: 100, other: 200 }
    }
    manager.setTripPlan('test-full-plan', fullPlan)
    const tripPlan = manager.getSession('test-full-plan').tripPlan
    // 摘要字段仍在（chat 系统提示用）
    assert.equal(tripPlan.city, '杭州')
    assert.equal(tripPlan.totalBudget, 1500)
    // 完整行程可恢复
    assert.deepEqual(tripPlan.plan, fullPlan)
})

test('listSessions 按 updatedAt 降序返回元数据', () => {
    const { manager } = makeTempManager()
    manager.ensureSession('s-old')
    manager.ensureSession('s-new')
    manager.ensureSession('s-mid')
    manager.appendMessage('s-old', 'user', '旧会话的消息')
    manager.appendMessage('s-mid', 'user', '中间会话的消息')
    manager.appendMessage('s-new', 'user', '新会话的消息')
    manager.setTripPlan('s-new', { city: '成都', days: 1, totalBudget: 500 })

    // 排序测试用固定时间戳（真实时间戳可能同毫秒，排序会不稳定）
    manager.getSession('s-old').updatedAt = '2026-08-15T10:00:00.000Z'
    manager.getSession('s-new').updatedAt = '2026-08-15T12:00:00.000Z'
    manager.getSession('s-mid').updatedAt = '2026-08-15T11:00:00.000Z'

    // 模拟 Phase 11 前的旧会话：直接改 tripPlan 字段（只有概要、无 plan）
    const sOld = manager.getSession('s-old')
    sOld.tripPlan = { city: '杭州', days: 2, totalBudget: 1000, updatedAt: '2026-08-15T10:00:00.000Z' }

    const list = manager.listSessions()
    assert.deepEqual(list.map(s => s.sessionId), ['s-new', 's-mid', 's-old'])
    // 元数据字段
    const full = list.find(s => s.sessionId === 's-new')
    assert.equal(full.city, '成都')
    assert.equal(full.messageCount, 1)
    assert.equal(full.preview, '新会话的消息')
    assert.equal(full.hasPlan, true)
    // hasPlan：有完整 plan 才是 true（s-old 只有概要，模拟 Phase 11 前的旧会话）
    const summary = list.find(s => s.sessionId === 's-old')
    assert.equal(summary.city, '杭州')
    assert.equal(summary.hasPlan, false)
})

test('deleteSession 删除并持久化；重复删除返回 false', () => {
    const { manager, file } = makeTempManager()
    manager.ensureSession('to-delete')
    manager.appendMessage('to-delete', 'user', '将被删除')

    assert.equal(manager.deleteSession('to-delete'), true)
    assert.equal(manager.getSession('to-delete'), null)
    // 重复删除：false（路由据此返回 404）
    assert.equal(manager.deleteSession('to-delete'), false)

    // 持久化：从磁盘重新加载后仍不存在
    const reloaded = new StateManager(file)
    assert.equal(reloaded.getSession('to-delete'), null)
    rmSync(file, { force: true })
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
