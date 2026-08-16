import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 会话 API 的 HTTP 层测试（Phase 11）：在测试端口启动真实服务，
// 通过 SESSIONS_FILE 环境变量指向临时会话文件——不污染运行时数据、不调用 LLM。
// 会话数据直接预置进临时文件（文件格式与 StateManager.persist 一致）。

const PORT = 3398
const base = `http://127.0.0.1:${PORT}`
const tempDir = mkdtempSync(join(tmpdir(), 'travel-session-api-'))
const sessionsFile = join(tempDir, 'sessions.json')
let server

// 预置 3 个会话：s-full（完整行程）/ s-summary（Phase 11 前旧格式，只有概要）/ s-chat（纯对话）
const fullPlan = {
    city: '杭州', days: 2, totalBudget: 1500,
    dailyItinerary: [{ day: 1, date: '第1天', morning: { spot: '西湖', duration: '约4小时', ticket: '免费', transportation: '步行', description: '世界文化遗产' } }],
    budgetBreakdown: { accommodation: 600, food: 400, transportation: 200, tickets: 100, other: 200 },
    tips: ['测试提示'], warnings: ['测试警告']
}

function seed() {
    writeFileSync(sessionsFile, JSON.stringify([
        ['s-full', {
            sessionId: 's-full',
            createdAt: '2026-08-15T10:00:00.000Z',
            updatedAt: '2026-08-15T12:00:00.000Z',
            history: [
                { role: 'user', content: '帮我规划杭州行程', at: '2026-08-15T11:00:00.000Z' },
                { role: 'assistant', content: '好的，正在规划', at: '2026-08-15T11:01:00.000Z' }
            ],
            tripPlan: { city: '杭州', days: 2, totalBudget: 1500, plan: fullPlan, updatedAt: '2026-08-15T12:00:00.000Z' }
        }],
        ['s-summary', {
            sessionId: 's-summary',
            createdAt: '2026-08-15T08:00:00.000Z',
            updatedAt: '2026-08-15T09:00:00.000Z',
            history: [],
            tripPlan: { city: '成都', days: 1, totalBudget: 800, updatedAt: '2026-08-15T09:00:00.000Z' }
        }],
        ['s-chat', {
            sessionId: 's-chat',
            createdAt: '2026-08-15T06:00:00.000Z',
            updatedAt: '2026-08-15T07:00:00.000Z',
            history: [
                { role: 'user', content: '西湖附近有什么好吃的？', at: '2026-08-15T06:30:00.000Z' }
            ],
            tripPlan: null
        }]
    ], null, 2))
}

before(async () => {
    seed()
    server = spawn('node', ['src/index.js'], {
        env: { ...process.env, PORT: String(PORT), SESSIONS_FILE: sessionsFile },
        cwd: new URL('../..', import.meta.url).pathname,
        stdio: 'ignore'
    })
    for (let i = 0; i < 50; i++) {
        try {
            const res = await fetch(`${base}/heartbeat`)
            if (res.ok) return
        } catch { /* 服务还没起来，继续等 */ }
        await new Promise(r => setTimeout(r, 200))
    }
    throw new Error('服务启动超时')
})

after(() => {
    server.kill()
    rmSync(tempDir, { recursive: true, force: true })
})

test('GET /sessions 返回按 updatedAt 降序的元数据列表', async () => {
    const res = await fetch(`${base}/api/travel/sessions`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.success, true)

    const list = body.data
    assert.equal(list.length, 3)
    assert.deepEqual(list.map(s => s.sessionId), ['s-full', 's-summary', 's-chat'])

    const full = list[0]
    assert.equal(full.city, '杭州')
    assert.equal(full.days, 2)
    assert.equal(full.totalBudget, 1500)
    assert.equal(full.hasPlan, true)
    assert.equal(full.messageCount, 2)
    assert.equal(full.preview, '帮我规划杭州行程')

    const summary = list[1]
    assert.equal(summary.hasPlan, false)       // 旧格式：有概要无完整行程
    assert.equal(summary.city, '成都')

    const chat = list[2]
    assert.equal(chat.city, null)
    assert.equal(chat.messageCount, 1)
    assert.equal(chat.preview, '西湖附近有什么好吃的？')
})

test('GET /sessions/:id 返回完整会话（含 history 与行程）', async () => {
    const res = await fetch(`${base}/api/travel/sessions/s-full`)
    assert.equal(res.status, 200)
    const session = (await res.json()).data
    assert.equal(session.sessionId, 's-full')
    assert.equal(session.history.length, 2)
    assert.equal(session.tripPlan.plan.dailyItinerary[0].morning.spot, '西湖')
})

test('GET /sessions/:id 不存在的会话返回 404', async () => {
    const res = await fetch(`${base}/api/travel/sessions/ghost`)
    assert.equal(res.status, 404)
    const body = await res.json()
    assert.equal(body.success, false)
})

test('DELETE /sessions/:id 删除并持久化到磁盘', async () => {
    const res = await fetch(`${base}/api/travel/sessions/s-chat`, { method: 'DELETE' })
    assert.equal(res.status, 200)

    // 列表里已没有
    const listRes = await fetch(`${base}/api/travel/sessions`)
    const list = (await listRes.json()).data
    assert.equal(list.length, 2)
    assert.ok(!list.some(s => s.sessionId === 's-chat'))

    // 磁盘上也没有（服务重启后可恢复删除结果）
    const onDisk = JSON.parse(readFileSync(sessionsFile, 'utf-8'))
    assert.ok(!onDisk.some(([id]) => id === 's-chat'))
})

test('DELETE 不存在的会话返回 404', async () => {
    const res = await fetch(`${base}/api/travel/sessions/ghost`, { method: 'DELETE' })
    assert.equal(res.status, 404)
})

test('POST /refine 缺少参数返回 400', async () => {
    const res = await fetch(`${base}/api/travel/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 's-full' })
    })
    assert.equal(res.status, 400)
})

test('POST /refine 旧会话（无完整行程）返回 400，且不调用 LLM', async () => {
    const res = await fetch(`${base}/api/travel/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 's-summary', instruction: '把行程改一改' })
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.match(body.message, /没有可修改的行程/)
})
