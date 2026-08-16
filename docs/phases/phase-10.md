# Phase 10 — Agent 执行轨迹可视化 + 成本统计

## 1. 本阶段目标

本阶段结束后，我能够：

> 把 Agent 的执行过程实时展示到前端：用户能看到每一轮工具调用、大纲生成、预算校验；同时把 token 成本从后端日志搬到界面。这是"面试时打开浏览器就能讲 Agent"的主场景。

---

## 2. 为什么学习这个？

### 上一阶段遗留的问题

Agent 的全部智能都在后端：执行轨迹只有终端日志，token 成本只有终端日志，会话数据没有 API。面试时你只能"描述" Agent 如何工作，无法"展示"。**描述 vs 展示，是面试效果的分水岭。**

### 新技术解决什么问题？

| 能力 | 说明 |
|---|---|
| 轨迹可视化 | 生成行程的 60 秒里，前端实时呈现"Agent 决策 → 工具执行 → 大纲 → 生成 → 校验"全过程 |
| 成本透明 | 每次请求的 token 与估算成本在界面可见（"我的"页 + 行程页） |
| 流式规划接口 | 新增 `/recommend/stream`，与 `/recommend` 共享同一个图（invoke 与 stream 只是同一执行引擎的两种消费方式） |

### 如果不用它？

面试官让你"打开项目看看"，你只能展示一个 60 秒的转圈动画——Agent 最精彩的部分（自主决策过程）完全不可见。

---

## 3. 核心概念

- **LangGraph stream() 的 streamMode**（本阶段核心技术，面试题）：
  - `updates`：节点级增量——每个节点完成时发出 `{节点名: 状态增量}`，**正好对应前端要展示的事件粒度**
  - `values`：超步完整状态——用于结束时取完整 messages 算 token
  - 其他模式（概念）：`messages`（token 流）、`debug`（最细粒度）、`custom`（节点自定义事件）
- **事件整形层**：后端把原始状态增量转成前端友好的事件（`traceEvents.js` 纯函数）——工具返回的内容在**服务端截断 200 字符**，移动端不收全量
- **诚实的时间线**：`updates` 模式只有"节点完成"事件，没有"节点开始"事件——前端用"最后完成节点 + 运行中 spinner"表达运行态，**不伪造框架没有的事件**
- **usage 持久化**：每次规划请求的 token 用量随会话落盘（usageLog），"我的"页聚合展示

---

## 4. 本阶段不学习什么

- 不做节点内 token 级流式（节点级事件足够展示决策过程；chat 已有 token 流式案例）
- 不做轨迹持久化/回放（轨迹是运行时视图，会话只恢复 history + tripPlan）
- 不统计 chat 的 token（SDK 流式响应无 usage，估算即误导——UI 注明局限）
- 不引入任何新依赖（原生 fetch SSE + Vant 组件足够）

---

## 5. 当前代码状态（Phase 09 结束时）

```text
后端：执行轨迹只有 logger 日志；usage 只打日志不落盘；
      无 /recommend/stream、无 /stats
前端：detail 页生成过程只有整页 spinner；profile 页空占位
```

---

## 6. 本阶段目标架构

```text
前端 detail 页
  │ POST /recommend/stream（SSE）
  ▼
路由（共享参数校验）→ ensureSession
  ▼
travelService.recommendStream
  → graph.stream(initialState, { streamMode: ['updates', 'values'] })
  → updates 增量 → shapeNodeEvent（traceEvents.js）→ SSE node 事件
  → 结束时 values 完整态 → sumMessagesUsage → done{plan, usage}
  ▼
前端 TracePanel 实时渲染时间线 → done 替换为行程 + 成本行
  ▼
usage 随会话落盘（usageLog）→ GET /stats 聚合 → profile 页统计卡
```

---

## 7. 文件变化

### 新增

```text
travel-recomend-backend/src/utils/traceEvents.js              # 节点增量 → 轨迹事件（纯函数）
travel-recomend-backend/src/__tests__/traceEvents.test.js     # 7 个整形测试
travel-recomend-backend/src/__tests__/recommendStream.test.js # 2 个流测试（事件序列 + 错误传播）
travel-recomend-backend/src/__tests__/usageStats.test.js      # 4 个统计测试
travel-recomend-front/src/utils/sse.ts                        # 通用 SSE 消费（从 chat.vue 提取）
travel-recomend-front/src/components/TracePanel.vue           # 轨迹时间线组件
```

### 修改

```text
travel-recomend-backend/src/services/stateManager.js   # usageLog / recordUsage / getStats
travel-recomend-backend/src/services/travelService.js  # recommendStream；recommend 记录 usage
travel-recomend-backend/src/routes/travel.js           # /recommend/stream、/stats；校验抽共享函数
travel-recomend-front/src/views/detail.vue             # 流式规划 + 轨迹面板 + 成本行
travel-recomend-front/src/views/chat.vue               # 改用 utils/sse.ts（行为不变）
travel-recomend-front/src/views/profile.vue            # 成本统计卡
```

---

## 8. 关键代码

### 8.1 流式执行（同一个图，两种消费方式）

```js
// src/services/travelService.js（节选）
async recommendStream(city, budget, days, sessionId = null, onEvent) {
    const stream = await this.graph.stream(initialState, { streamMode: ['updates', 'values'] })
    let finalState = null
    let seq = 0
    for await (const [mode, chunk] of stream) {
        if (mode === 'updates') {
            for (const [nodeName, update] of Object.entries(chunk)) {
                const event = shapeNodeEvent(nodeName, update, seq++)
                if (event) onEvent(event)
            }
        } else if (mode === 'values') {
            finalState = chunk
        }
    }
    const plan = finalState?.plan
    const usage = sumMessagesUsage(finalState?.messages ?? [])
    if (sessionId) {
        stateManager.setTripPlan(sessionId, plan)
        stateManager.recordUsage(sessionId, 'recommend', usage)
    }
    return { plan, usage }
}
```

**解释**：`graph.invoke`（recommend 用）与 `graph.stream`（本方法用）是同一执行引擎的两种消费方式——**图零改动，53 个旧测试和 eval 脚本不受任何影响**。节点抛错时 for-await 直接向上抛，由路由层转成 SSE error 事件。

### 8.2 事件整形（纯函数，可单测）

```js
// src/utils/traceEvents.js（节选）
case 'tools': {
    const results = (update.messages ?? []).map(message => {
        let parsed = null
        try { parsed = JSON.parse(message.content) } catch {}
        return {
            preview: truncate(message.content, 200),   // 服务端截断，移动端不收全量
            hasError: typeof parsed?.error === 'string'
        }
    })
    return { type: 'node', seq, node: 'tools', data: { results } }
}
```

### 8.3 前端时间线

```vue
<!-- TracePanel.vue（节选） -->
<van-steps direction="vertical" :active="events.length - 1">
    <van-step v-for="event in events" :key="event.seq">
        <van-tag :type="tagType(event)">{{ labelOf(event.node) }}</van-tag>
        <span>{{ summaryOf(event) }}</span>
        <van-collapse v-if="hasDetail(event)">…工具参数/结果/校验错误…</van-collapse>
    </van-step>
</van-steps>
<div v-if="running"><van-loading>Agent 思考中…</van-loading></div>
```

---

## 9. 完整数据流

```text
detail 页点击"开始规划"
  → streamPost('recommend/stream')
  → SSE：start → node(agent 第1轮：请求 get_weather+search_attractions)
        → node(tools：天气结果 + 景点结果预览)
        → node(agent 第2轮：…) → node(tools) → node(agent：停止搜索)
        → node(planner：大纲锁定) → node(executor：行程生成) → node(validator：通过)
        → done{plan, usage}（只发一次）
  → TracePanel 逐条点亮 → 行程渲染 + "本次请求成本"卡片
  → usage 落会话 usageLog → profile 页 /stats 聚合
```

---

## 10. 运行方式

```bash
cd travel-recomend-backend && npm test     # 66 个测试
cd travel-recomend-front && npm run build  # TS + 构建
# 后端 npm run dev + 前端 npm run dev，浏览器走一遍：
# 首页 → 开始规划 → 观察轨迹时间线 → 行程 + 成本行 → "我的"页统计卡
```

```bash
# 直接看事件流：
curl -N -X POST http://127.0.0.1:3300/api/travel/recommend/stream \
  -H 'Content-Type: application/json' \
  -d '{"city":"成都","budget":500,"days":1}'
```

---

## 11. 测试

### 11.1 确定性测试（npm test，66/66）

```text
traceEvents（7 个）：
✔ agent 节点：有工具调用时输出轮次与调用清单
✔ agent 节点：无工具调用 = 自主终止
✔ tools 节点：解析结果并标记 error，超长内容截断
✔ planner 节点：成功与降级两种形态
✔ validator 节点：通过与失败
✔ replan_feedback 节点：携带校验错误
✔ 未知节点静默忽略

recommendStream（2 个）：
✔ 事件序列完整覆盖核心节点，最终返回 plan 和 usage
✔ 图节点抛错（max_iter 兜底）时 stream 向上抛出

usageStats（4 个）：recordUsage 累计 / getStats 聚合 / 持久化恢复 / 未知会话安全
（连同 Phase 00-09 的 53 个，共 66 个，全部通过）
```

### 11.2 真实事件流实录（成功路径，成都 1 天 500 元）

```text
事件统计：start ×1，node ×8，done ×1（无重复）
节点序列：
  agent → tools → agent → tools → agent（停止搜索）
  → planner → executor → validator
done 事件携带：
  plan（完整行程 JSON）+ usage（输入 8955 + 输出 4088 tokens）
```

### 11.3 真实事件流实录（失败路径，西安 4 天 2500 元）

```text
节点序列：agent → tools × 5 轮（模型反复搜索）
error 事件：{"type":"error","message":"Agent 达到最大迭代次数（5 轮）仍未停止工具调用"}
```

失败路径验证了 SSE 的错误传播：图节点抛错 → for-await 抛出 → 路由层转 error 事件 → 前端显示错误信息。**轨迹让失败也可见**——用户能看到 Agent 卡在哪一轮。

### 11.4 /stats 真实聚合

```text
GET /api/travel/stats
→ {"sessionCount":28,"requestCount":2,"inputTokens":18077,"outputTokens":9292,
   "estimatedCost":0.0166}
```

---

## 12. 调试指南（本阶段真实踩坑）

### 踩坑 1：done 事件发重了，前端行程被空事件覆盖

现象：真实调用实录里 `"type":"done"` 出现两次——一次带数据、一次空。
根因：路由里先 `send({type:'done', ...})` 又调 `done()`（done 内部会再写一条 done 并关连接）。前端的 done 处理器用空事件的 `plan: undefined` 覆盖了已渲染的行程。
修法：`done(payload)` 本身支持携带数据——一次调用，事件只发一条。
收获：**"发送事件"和"关闭连接"合并成一个动作**，协议设计上杜绝双发。这个 bug 是真实实录抓出来的，不是测试抓出来的——单测只测了事件整形和流序列，没测路由层的协议实现。接口层的"只发一次"语义需要端到端实录验证。

### 踩坑 2：验证时多实例并存，打到旧代码

现象：修复后重测仍见旧行为（done 双发）。
根因：之前为了用户测试起过 detached 后端，kill 时只杀了一个 PID，旧实例还在服务。
修法：pgrep 列出全部 `node src/index.js` 逐个 kill，确认端口释放后再起新实例。
收获：**验证前先确认"打到的服务是哪份代码"**——Phase 02 踩过的坑（nodemon 热重载）在 detached 进程场景下重演。

### 踩坑 3：西安 4 天在流式实录里再次触发 max_iter

现象：成功实录前先用西安 4 天做记录，得到 5 轮全是工具调用 + error 事件。
收获：这不算"意外"——Phase 08 的 eval 已知 4 天行程的搜索预算问题。但流式版本让这个失败**可视化了**：前端时间线会完整呈现 5 轮 agent 决策，用户看到"Agent 在反复搜索"。失败路径的轨迹同样是产品价值（透明），且它是 Phase 11 会话历史/修改行程的真实素材。

---

## 13. 常见错误

- 把 stream 事件当"状态"用——轨迹是只读视图，状态在 messages/plan 里
- 前端接收全量工具结果——服务端截断是移动端的基本功
- 伪造框架没有的事件（如 node_start）——诚实呈现"完成即展示"
- send + done 双发同一语义事件——协议设计里"发送即结束"要合并

---

## 14. 和上一阶段的关系

Phase 08 的 eval 证明了 Agent "有多好"；Phase 10 让 Agent 的过程"看得见"。两者的共同点：**把能力变成可感知的证据**——一个是数字证据（eval 报告），一个是视觉证据（执行轨迹）。面试时两者配合：先演示轨迹（感受 Agent 自主性），再给数字（证明可靠性）。

下一阶段（Phase 11 — 会话历史 + 行程追问修改）：把会话数据通过 API 暴露（列表/详情/删除），并实现"修改行程"——用户说"把第二天改成西湖"，Agent 重跑整个图生成新行程（与 Phase 06 validator 触发的 re-plan 对称）。

---

## 15. 面试问题（附参考回答）

### 基础

**Q1：你怎么把 Agent 的执行过程展示给用户？**

参考回答：用 LangGraph 的 `stream()` 多模式流——`updates` 模式在每个节点完成时发出状态增量，8 个节点正好对应 8 类轨迹事件（决策/工具/大纲/生成/校验）；`values` 模式补完整状态，用于结束时算 token。后端有一个纯函数整形层把增量转成前端友好的事件（工具结果在服务端截断 200 字符）。前端用 van-steps 时间线实时渲染。两点诚实设计：updates 模式没有"节点开始"事件，所以用"最后完成节点 + spinner"表达运行态，不伪造事件；轨迹是只读视图，不持久化——会话恢复只恢复结果不重放轨迹。

**Q2：streamMode 有哪些取值？各有什么区别？**

参考回答：`updates` 是节点级增量（每个节点完成发一次）；`values` 是每个超步的完整状态快照；`messages` 是 LLM 的 token 级流；`debug` 最细（含每次内部调用）；`custom` 是节点自定义事件（需要在节点里 getWriter）。我选 updates + values 组合：updates 的粒度与"展示 Agent 决策"的需求精确匹配，values 用来拿最终完整状态算成本。选 modes 的原则是够用即可——debug 级别的事件量会淹没前端。

**Q3：为什么没有 token 级的行程流式输出？**

参考回答：两个原因：① 行程是结构化 JSON，token 流式展示对用户没有阅读价值（chat 对话才有，那里已经做了）；② 节点级事件已经完整表达 Agent 的思考过程。如果面试官追问成本：行程 token 流式需要把节点的 invoke 改成 stream + messages 模式，改动大收益小——这是有意识的克制。

### 项目实践

**Q1：你的成本统计怎么做的？哪里来的数据？**

参考回答：两条链路：① 单次请求——图执行完的消息历史里，每个 AIMessage 自带 usage_metadata，零侵入汇总输入/输出 token，估算成本，随 done 事件返回前端（行程页展示）；② 全局聚合——每次规划的 usage 随会话落盘（usageLog 字段，随 sessions.json 持久化），`GET /stats` 聚合所有会话（"我的"页展示）。诚实边界：chat 对话的 token 因 SDK 流式响应没有 usage 而未统计，UI 上明确注明——估算的数字比没有数字更危险。

**Q2：你的轨迹事件为什么要在服务端整形？直接透传不行吗？**

参考回答：三个原因：① 安全与体积——工具返回的 JSON 可能数 KB，移动端不该收全量，服务端截断 200 字符；② 协议稳定——LangGraph 的状态增量结构会随图演化，整形层把内部结构翻译成稳定的前端协议，前端不感知后端变化；③ 可测试——整形是纯函数，喂伪造增量就能断言输出，不依赖 LLM 和图运行时。

**Q3：失败时轨迹怎么表现？**

参考回答：失败也完整呈现——我实录过一条失败流：模型 5 轮反复搜索触发 max_iter，前端时间线会展示全部 5 轮 agent 决策，最后收到 error 事件展示明确错误信息。轨迹让失败透明，用户能看到 Agent 卡在哪。这也是产品价值：Agent 不是黑盒。

### 深挖

**Q1：为什么用 graph.stream 而不是 graph.streamEvents？**

参考回答：streamEvents 的协议更重（v2/v3 事件信封、transformers 概念），它的价值在于极细粒度的事件溯源。我的需求是节点级轨迹——`updates` 模式的语义恰好就是这个粒度，一个 for-await 循环就能消费。选型的标准是"语义匹配 + 实现复杂度"：updates 模式零节点改动、零协议学习成本，streamEvents 则要为理解协议付出成本而拿不到额外收益。

**Q2：轨迹信息量太大怎么办？你的设计里有哪些控制手段？**

参考回答：四层控制：① 粒度控制——选 updates 而非 debug 模式，事件量就是节点数；② 内容截断——工具结果服务端截 200 字符，详情折叠默认收起（van-collapse）；③ 不持久化——轨迹只活在一次请求的生命周期里；④ 失败即停——error 事件后流关闭，不再产生事件。如果未来要做轨迹回放（审计场景），才需要持久化和检索设计——那是另一个量级的问题。

---

## 16. 毕业检查

### 代码

- [x] /recommend/stream：start → node×N → done{plan, usage}，单 done 无重复
- [x] traceEvents 整形层（纯函数 + 服务端截断 + error 标记）
- [x] usage 落盘（usageLog）+ /stats 聚合 + /recommend 响应不变（只记录）
- [x] 前端：TracePanel 时间线 + detail 流式化 + profile 统计卡 + chat 复用 sse.ts
- [x] 13 个新测试，全量 66/66
- [x] 真实实录：成功路径（8 节点 + done + usage）+ 失败路径（error 事件）双录
- [x] 没有实现下一阶段内容（无会话列表/删除/refine 接口）

### 理解

- [ ] 我能说出 streamMode 四种模式的语义与我的选择理由
- [ ] 我能解释"为什么在服务端整形轨迹事件"
- [ ] 我能讲清 done 双发的 bug 是怎么被实录抓出来的
- [ ] 我能解释"不伪造 node_start 事件"的诚实设计
- [ ] 我能回答"面试问题"章节的全部问题

### 用户确认

```text
User Confirmation: PENDING
```

---

## 17. 本阶段总结

### 我学会了

- LangGraph stream() 多模式流与节点级事件的消费
- 事件整形层的设计（协议稳定 + 内容截断 + 可测试）
- usage 的落盘与聚合（单次 + 全局两级统计）
- SSE 协议的"发送即结束"防双发设计
- 前端轨迹时间线的组件化

### 我还不会

- 会话数据的 API 化与列表交互（Phase 11）
- "修改行程"的 refine 语义（Phase 11）

### 下一阶段

```text
Phase 11 — 会话历史 + 行程追问修改
```
