# Phase 00 — 项目理解与跑通

## 1. 本阶段目标

本阶段结束后，我能够：

> 彻底理解现有项目的数据流，修复阻断性问题（后端崩溃、前端构建失败、功能断链），并建立基础工程设施（错误处理、smoke 测试、统一 SSE 协议、聊天页）。

---

## 2. 为什么学习这个？

### 修复前项目的问题

1. **后端一打就死**：[routes/travel.js](travel-recomend-backend/src/routes/travel.js) 的 async 路由没有错误处理。Express 4 不会自动捕获 async 函数抛出的异常，一次非法请求（如 `budget=50`）触发 `unhandledRejection`，**整个 Node 进程退出**。实测：修前发一次 `budget=50`，服务端日志出现 Node 崩溃栈，后续所有请求连接失败（HTTP 000）。
2. **前端无法构建**：`npm run build` 有 5 个 TS 错误。根因之一是 [App.vue](travel-recomend-front/src/App.vue) 混入了微信小程序语法（`active="{{ active }}"`、`bind:change`），在 Vue 中不生效。
3. **功能断链**：后端返回的行程 JSON，前端只渲染了概览卡，`dailyItinerary`/`budgetBreakdown`/`tips`/`warnings` 全部没有渲染；`/chat` 的 SSE 流没有任何前端消费（chat.vue 是空页）。
4. **错误契约混乱**：路由外层恒返回 `success:true`，service 解析失败时把 `{success:false}` 包进 `data` 里，前端检查的是外层 → 失败时既不显示错误也不显示数据（白屏）。

### 本阶段解决什么问题？

- 理解"LLM 应用"的完整数据流（前端 → API → Service → LLM → 前端渲染）
- 建立正确的错误处理姿势——这是后续所有 Agent 阶段的地基

### 如果不用它？

没有错误处理：一个用户输入非法预算 → 服务崩溃 → 所有用户不可用。这是生产项目的最低红线，也是面试官一眼能看出的工程素养问题。

---

## 3. 核心概念

- **Express 中间件**：请求处理管道；错误处理中间件必须有 4 个参数 `(err, req, res, next)`，且必须放在所有路由之后
- **async 异常与 unhandledRejection**：为什么 Express 4 不捕获 async 抛错、为什么它会杀死进程
- **HTTP 响应契约**：非 2xx 即失败；`{success, data, message}` 单层信封，不再嵌套
- **SSE（Server-Sent Events）**：`text/event-stream` 响应头、`data: {json}\n\n` 事件格式、chunk/done/error 三种事件
- **参数校验的位置**：HTTP 边界（路由层）返回 400，Service 层只做业务逻辑
- **vue-tsc 构建检查**：TypeScript 严格模式在构建期拦截错误（含模板里的语法错误）

---

## 4. 本阶段不学习什么

- 不学 Agent 概念：Tool Calling / Agent Loop / State 都是后面 Phase 的事
- 不做 Structured Output：正则提取 JSON 的脆弱性**留给 Phase 01 当教材**
- 不引入任何新依赖（smoke test 用 Node 内置的 `node:test`）

---

## 5. 修复前代码状态

```text
Vue 前端 (home → detail)
   │  axios POST /api/travel/recommend
   ▼
Express 路由 (async 无错误处理)  ← 非法输入 → unhandledRejection → 进程崩溃
   ▼
TravelService
   │  prompt 模板 + 正则提取 JSON（贪婪匹配，尾随文本即失败）
   ▼
LLM (SiliconFlow / ChatOpenAI)
   ▼
响应 {success:true, data:{success:false,...}}  ← 双层信封互相矛盾
   ▼
前端 detail 页：只显示概览卡；失败时白屏；chat 页是空壳
```

---

## 6. 本阶段目标架构

```text
Vue 前端
   │  axios（/api/travel 走 vite 代理） / fetch 消费 SSE
   ▼
Express 路由
   │  参数校验（400）+ asyncHandler 包装
   ▼
TravelService ── LLM（maxTokens + timeout 已配置）
   ▼
成功 → {success:true, data}  失败 → {success:false, message} + 对应 HTTP 状态码
   ▼
全局错误中间件（兜底 500，进程不再崩溃）
   ▼
detail 页完整渲染行程；chat 页实时流式对话（chunk/done/error 协议）
```

---

## 7. 文件变化

### 新增

```text
travel-recomend-backend/src/utils/asyncHandler.js      # async 路由包装器
travel-recomend-backend/src/__tests__/smoke.test.js    # node:test 冒烟测试
travel-recomend-front/src/utils/request.ts             # axios 封装 + BASE_URL（含 env 支持）
AGENT.md / docs/ROADMAP.md / docs/PROGRESS.md          # 学习体系控制文件
```

### 修改

```text
travel-recomend-backend/src/index.js                   # 全局错误处理中间件
travel-recomend-backend/src/routes/travel.js           # 校验移到路由 + asyncHandler + SSE 协议
travel-recomend-backend/src/services/travelService.js  # 删除重复校验 + maxTokens/timeout
travel-recomend-backend/src/utils/streamUtils.js       # flushHeaders + chunk/done/error 协议
travel-recomend-backend/package.json                   # test 脚本改为 node --test
travel-recomend-front/src/App.vue                      # 小程序语法 → Vue 语法
travel-recomend-front/src/views/detail.vue             # lang=ts + 类型 + 完整渲染行程
travel-recomend-front/src/views/home.vue               # 参数类型 + 清理重复城市/死状态
travel-recomend-front/src/views/chat.vue               # 从空壳 → 完整 SSE 聊天页
travel-recomend-front/vite.config.ts                   # /api 开发代理
```

### 删除

```text
HelloWorld.vue / vite.svg / vue.svg / hero.png / icons.svg / style.css  # Vite 脚手架残留
travel-recomend-front/utils/request.js  # 由 src/utils/request.ts 取代
```

---

## 8. 关键代码

### 8.1 asyncHandler + 全局错误中间件

```js
// src/utils/asyncHandler.js
export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
}
```

```js
// src/index.js（路由之后、listen 之前）
app.use((err, req, res, next) => {
    console.error('未捕获错误：', err)
    if (res.headersSent) {
        return next(err)   // 响应头已发送（如 SSE 中途），交给默认处理器
    }
    res.status(err.status || 500).json({
        success: false,
        message: err.message || '服务器内部错误'
    })
})
```

**解释**：asyncHandler 把 rejected Promise 转交给 Express 的 `next(err)` 链路；全局错误中间件统一兜底。`res.headersSent` 分支处理"响应已经开始发送"的场景（比如 SSE 流写到一半出错）。

### 8.2 参数校验放在 HTTP 边界

```js
// src/routes/travel.js
router.post('/recommend', asyncHandler(async (req, res) => {
    const { city, budget, days } = req.body
    if (!city || budget === undefined || budget === null || days === undefined || days === null) {
        return res.status(400).json({ success: false, message: '缺少必要参数' })
    }
    const budgetNum = Number(budget)
    const daysNum = Number(days)
    if (!Number.isFinite(budgetNum) || budgetNum < 100) {
        return res.status(400).json({ success: false, message: '预算不能低于100元' })
    }
    if (!Number.isInteger(daysNum) || daysNum < 1 || daysNum > 30) {
        return res.status(400).json({ success: false, message: '天数必须在1-30天之间' })
    }
    ...
}))
```

**解释**：非法输入是"客户端的错"，用 400 表达；Service 层的异常是"服务端的错"，走 500。注意 `Number('abc')` 是 `NaN`，`NaN < 100` 为 false 会漏过校验，所以必须用 `Number.isFinite`。

### 8.3 SSE 统一协议（chunk / done / error）

```js
// src/utils/streamUtils.js
const write = (data) => { res.write(`data: ${JSON.stringify(data)}\n\n`) }
return {
    send: (data) => write(data),              // 自定义事件，如 { type:'chunk', content }
    done: () => { write({ type: 'done' }); res.end() },
    error: (message) => { write({ type: 'error', message }); res.end() }
}
```

**解释**：三种事件各司其职——`chunk` 是增量文本，`done` 是正常结束信号，`error` 是异常结束信号。`res.flushHeaders()` 让客户端立即进入流式读取，不用等第一个事件。

### 8.4 前端消费 SSE（fetch 流式读取）

```ts
// src/views/chat.vue（节选）
const res = await fetch(`${BASE_URL}chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text })
})
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')       // SSE 事件以空行分隔
    buffer = parts.pop() ?? ''               // 最后一段可能不完整，留下次
    for (const part of parts) {
        const dataLine = part.split('\n').find(line => line.startsWith('data: '))
        if (!dataLine) continue
        const event = JSON.parse(dataLine.slice(6))
        if (event.type === 'chunk') assistantMsg.content += event.content
        else if (event.type === 'error') throw new Error(event.message)
    }
}
```

**解释**：`EventSource` 只支持 GET，所以 POST 的流式接口必须用 `fetch` + `ReadableStream` 手动解析。关键细节：`decoder.decode(value, {stream:true})` 处理多字节字符被切半的情况；buffer 按 `\n\n` 切分时**最后一段必须留下**，否则会把半个事件当完整事件解析。

### 8.5 冒烟测试（零新依赖）

```js
// src/__tests__/smoke.test.js（节选）
before(async () => {
    server = spawn('node', ['src/index.js'], {
        env: { ...process.env, PORT: String(PORT) },
        cwd: new URL('../..', import.meta.url).pathname,
        stdio: 'ignore'
    })
    // 轮询心跳直到服务就绪
})

test('非法预算返回 400 且服务不崩溃（回归测试）', async () => {
    const res = await fetch(`${base}/api/travel/recommend`, { /* budget: 50 */ })
    assert.equal(res.status, 400)
    const alive = await fetch(`${base}/heartbeat`)   // 关键断言：服务还活着
    assert.equal(alive.status, 200)
})
```

**解释**：测试用真实子进程启动服务（PORT 环境变量优先于 .env），只覆盖不调用 LLM 的路径——**不消耗 API 配额**。这个"非法请求后服务仍存活"的断言，就是本次崩溃 bug 的回归测试。

---

## 9. 完整数据流

```text
User（浏览器）
 ↓
Vue 组件（home → detail / chat）
 ↓
axios 或 fetch（/api/travel/**，dev 环境走 vite 代理 → 127.0.0.1:3300）
 ↓
Express 路由（参数校验 400 / asyncHandler）
 ↓
TravelService（prompt 模板 / 流式调用）
 ↓
LLM（ChatOpenAI → SiliconFlow，maxTokens 4096 / timeout 60s）
 ↓
成功：{success:true, data}       失败：{success:false, message} + 4xx/5xx
 ↓                                 ↑
前端渲染（行程页 / 聊天流）     全局错误中间件兜底（进程不崩）
```

---

## 10. 运行方式

```bash
# 后端（默认端口 3300，需先配置 travel-recomend-backend/.env 的 API Key）
cd travel-recomend-backend
npm install
npm run dev        # nodemon 热重载
npm test           # 冒烟测试（5 个用例，不消耗 API 配额）

# 前端（dev server 默认 5173，/api 自动代理到后端）
cd travel-recomend-front
npm install
npm run dev
npm run build      # vue-tsc 类型检查 + 产物构建
```

浏览器访问 `http://localhost:5173`，流程：首页选城市 → 填预算/天数 → 开始规划 → detail 页看行程；底部 tab 切到"对话"发消息看流式回复。

---

## 11. 测试

### 冒烟测试真实输出（npm test）

```text
✔ 心跳接口可用 (427.086283ms)
✔ 缺少参数返回 400 (10.561498ms)
✔ 非法预算返回 400 且服务不崩溃（回归测试） (5.286157ms)
✔ 非法天数返回 400 (2.765671ms)
✔ 对话接口缺少 message 返回 400 (2.687662ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

### 修复前后对比（budget=50）

修复前：

```text
（服务端日志出现 unhandledRejection 崩溃栈，进程退出）
curl 结果：HTTP状态:000（连接失败——因为服务已经死了）
```

修复后：

```text
{"success":false,"message":"预算不能低于100元"}
HTTP:400
（紧接着心跳接口正常，服务存活）
```

### 真实 LLM 调用（修复后验证）

```text
POST /api/travel/recommend {"city":"杭州","budget":600,"days":1}
HTTP:200
{"success":true,"data":{"success":true,"city":"杭州","days":1,"totalBudget":600,
 "dailyItinerary":[{"day":1,"morning":{"spot":"西湖（含游船）","duration":"3小时",...}}]}}
```

### SSE 流式真实输出

```text
POST /api/travel/chat {"message":"只回复两个字：好的"}
data: {"type":"chunk","content":"好的"}

data: {"type":"done"}
```

---

## 12. 调试指南

### 问题 1（修复前）：服务"突然"挂了

现象：一次请求后，所有接口连接失败（HTTP 000）。
检查：服务端日志出现 `UnhandledPromiseRejection` 崩溃栈和 `Node.js v24.x` 结尾；用 `curl budget=50` 可稳定复现。
结论：Express 4 不捕获 async 异常。修法见 8.1。

### 问题 2（修复前）：detail 页失败时白屏

现象：模型输出解析失败时，页面既没有数据也没有错误提示。
检查：路由返回 `{success:true, data:{success:false}}`，前端判断的是外层 success → 永远为 true → 进入渲染分支但数据不满足条件 → 空白。
结论：信封契约混乱。修法：非 2xx 即失败，body 单层 `{success, message}`。

### 问题 3（修复前）：npm run build 报 5 个 TS 错误

现象：`vue-tsc -b` 退出码 2。
检查：`src/App.vue(6,7): 'onChange' is declared but never read` + 多个 implicit any + `detail.vue` 缺声明文件。
结论：① App.vue 用了微信小程序语法（`active="{{ active }}"` 在 Vue 里是字面量字符串），onChange 从未被触发；② 有参数未标注类型的函数；③ detail.vue 没写 `lang="ts"` 不被类型检查，反而导致 router 里找不到它的类型。修法：Vue 语法 `:active`/`@change`、参数类型注解、补 `lang="ts"` 并定义 `TripData` 接口。

### 问题 4（本次开发中踩到）：`node --test src/__tests__/` 报 MODULE_NOT_FOUND

现象：`Cannot find module '.../src/__tests__'`。
检查：该 Node 版本不接受目录参数（把目录当模块加载）。
结论：改用 `node --test`（自动发现 `**/*.test.js`），test 脚本直接写 `node --test`。

---

## 13. 常见错误

- Express 4 里裸写 async 路由处理器（没有 asyncHandler / try-catch）——本次崩溃的根因
- 用正则 `\{[\s\S]*\}` 贪婪提取 LLM 输出 JSON——尾随文本即失败（Phase 01 将解决）
- SSE 不调 `res.flushHeaders()`——客户端要等第一个事件才收到响应头
- fetch 流式解析时把 buffer 里最后一段不完整事件当完整事件解析
- 校验数字时只用 `<`/`>` 比较，漏掉 `NaN`——`Number('abc')` 能穿过 `NaN < 100` 为 false 的判断

---

## 14. 和上一阶段的关系

本阶段是学习路线的起点（没有上一阶段）。

下一阶段 Phase 01（Structured Output）将解决本阶段刻意保留的问题：`travelService.recommend` 里靠正则提取 JSON 的脆弱性，升级为可验证的结构化输出。

---

## 15. 面试问题（附参考回答）

### 基础

**Q1：Express 4 的 async 路由抛异常会发生什么？**

参考回答：Express 4 不会捕获 async 函数抛出的异常，Promise 被拒绝后没人处理，触发 unhandledRejection，默认行为是整个 Node 进程崩溃。我在 Phase 00 就踩过这个坑：一次非法请求直接把服务打挂。解决方案是用 asyncHandler 包装 async 路由，把异常转交给 `next(err)`，再由全局错误处理中间件统一返回 500。Express 5 原生支持 async 错误传递，但升级框架是另一个决策。

**Q2：参数校验应该放在哪一层？为什么？**

参考回答：HTTP 边界，也就是路由层。非法输入是客户端的问题，应该返回 400 并给出明确 message；Service 层只做业务逻辑，它抛的异常代表服务端问题，走 500。另外校验数字时要注意 `NaN` 穿透 `比较运算符` 的问题，我用 `Number.isFinite` / `Number.isInteger` 做严格校验。

**Q3：SSE 和 WebSocket 的区别？为什么聊天用 SSE？**

参考回答：SSE 是 HTTP 上的单向流（服务端→客户端），基于标准 HTTP，可以走代理、自动重连、实现简单；WebSocket 是双向全双工，握手和心跳都要自己管理。我这个聊天场景是"客户端发一条消息、服务端流式回一段"，单向流足够，用 SSE 更简单。POST + SSE 因为 EventSource 不支持带 body，所以用 fetch 手动读流。

### 项目实践

**Q1：你的项目里 `/api/travel/chat` 的流式事件协议是什么？**

参考回答：三种事件——`chunk`（增量文本）、`done`（正常结束）、`error`（异常结束，带 message）。前端用 fetch 读 ReadableStream，按 `\n\n` 切事件，用 TextDecoder 的 stream 模式处理多字节字符被切半的情况，buffer 里最后一段不完整事件留到下一轮拼接。

**Q2：你的冒烟测试怎么做到不花钱的？**

参考回答：用 node:test 起真实子进程（PORT 环境变量优先于 .env），只测心跳、参数校验、以及"非法请求之后服务还活着"的回归断言——这些路径不调用 LLM。LLM 相关的验证是手动用真实 API 各跑一次成功和失败路径。

**Q3：修复这个崩溃 bug 前后，你的响应契约发生了什么变化？**

参考回答：之前是外层恒 `success:true`、失败信息包在 data 里的双层信封，前端判断外层导致失败时白屏。改成单层契约：HTTP 状态码表达成败（400 参数错、500 服务错），body 里 `success` 与 `message` 只服务于状态码内的语义，前端走 axios 的正常/异常两条路径。

### 深挖

**Q1：如果 LLM 调用挂死（比如模型卡住不返回），你的系统会怎样？现在有哪些防护？**

参考回答：现在有两层：后端 ChatOpenAI 配了 60s timeout，超时抛错走错误中间件返回 500；前端 axios 有 180s 超时兜底。更深一层是成本控制：maxTokens 4096 限制单次回复上限，避免模型失控长输出烧 token。后续 Phase 08 还会做 retry 和降级策略。

---

## 16. 毕业检查

### 代码

- [x] 修复后端崩溃（asyncHandler + 全局错误中间件）
- [x] 修复前端构建（npm run build 通过）
- [x] 统一错误契约 + detail 页完整渲染
- [x] chat 页消费 SSE + 协议统一
- [x] smoke test 5/5 通过
- [x] 没有实现下一阶段内容（Structured Output 原样留给 Phase 01）

### 理解

- [ ] 我能解释为什么 async 路由异常会杀死 Express 4 进程
- [ ] 我能画出"前端 → 路由 → Service → LLM → 前端"的完整数据流
- [ ] 我能解释 chunk/done/error 三种 SSE 事件的职责
- [ ] 我能说出参数校验放在路由层而不是 Service 层的原因
- [ ] 我能回答"面试问题"章节的全部问题

### 用户确认

```text
User Confirmation: PENDING
```

---

## 17. 本阶段总结

### 我学会了

- Express 错误处理链：asyncHandler → next(err) → 全局错误中间件
- 单层响应契约：非 2xx 即失败
- SSE 全链路：服务端 flushHeaders + 三事件协议；前端 fetch 流式解析（含 buffer 切分细节）
- node:test 冒烟测试：真实子进程 + 回归断言，零新依赖

### 我还不会

- 如何保证 LLM 输出可靠 JSON（Phase 01 解决）
- Agent 相关概念（Phase 02+ 逐步解决）

### 下一阶段

```text
Phase 01 — Structured Output
```
