import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

// 冒烟测试：验证服务能启动、参数校验返回 400、且非法请求不会杀死进程。
// 使用 node:test 内置测试框架，零新依赖。
// 注意：本测试不调用真实 LLM（不消耗 API 配额），只覆盖不花钱的路径。

const PORT = 3399
const base = `http://127.0.0.1:${PORT}`
let server

before(async () => {
    // 在测试端口启动真实服务（PORT 环境变量优先于 .env）
    server = spawn('node', ['src/index.js'], {
        env: { ...process.env, PORT: String(PORT) },
        cwd: new URL('../..', import.meta.url).pathname,
        stdio: 'ignore'
    })

    // 等待服务就绪：轮询心跳接口
    for (let i = 0; i < 50; i++) {
        try {
            const res = await fetch(`${base}/heartbeat`)
            if (res.ok) return
        } catch {
            // 服务还没起来，继续等
        }
        await new Promise(r => setTimeout(r, 200))
    }
    throw new Error('服务启动超时')
})

after(() => {
    server.kill()
})

test('心跳接口可用', async () => {
    const res = await fetch(`${base}/heartbeat`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.message, '服务正常运行')
})

test('缺少参数返回 400', async () => {
    const res = await fetch(`${base}/api/travel/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city: '北京' })
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.equal(body.success, false)
})

test('非法预算返回 400 且服务不崩溃（回归测试）', async () => {
    // 修复前：budget=50 会让 service 抛异常，Express 4 不捕获 async 异常，
    // unhandledRejection 直接杀死整个 Node 进程。
    const res = await fetch(`${base}/api/travel/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city: '北京', budget: 50, days: 3 })
    })
    assert.equal(res.status, 400)

    // 关键断言：非法请求之后服务仍然存活
    const alive = await fetch(`${base}/heartbeat`)
    assert.equal(alive.status, 200)
})

test('非法天数返回 400', async () => {
    const res = await fetch(`${base}/api/travel/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city: '北京', budget: 1000, days: 99 })
    })
    assert.equal(res.status, 400)
})

test('对话接口缺少 message 返回 400', async () => {
    const res = await fetch(`${base}/api/travel/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    })
    assert.equal(res.status, 400)
})
