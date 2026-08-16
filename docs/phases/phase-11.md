# Phase 11 — 会话历史 + 行程追问修改

## 1. 本阶段目标

本阶段结束后，我能够：

> 把会话数据通过 API 暴露（列表/详情/删除），并实现"修改行程"——用户对已有行程提出指令（"把预算压缩 20%"），Agent 重跑整个图生成新行程。至此，单用户产品体验闭环：**规划 → 追问 → 修改 → 历史管理**。

---

## 2. 为什么学习这个？

### 上一阶段遗留的问题

Phase 10 让 Agent 的执行过程"看得见"，但会话数据仍锁在服务端 JSON 文件里：没有列表、不能恢复、不能删除。更关键的是——**行程生成后不可修改**。用户说"把第二天改成西湖"，系统只能让他重新规划（丢失已有行程的合理部分）。

### 新技术解决什么问题？

| 能力 | 说明 |
|---|---|
| 会话 API | `GET /sessions`（列表）/ `GET /sessions/:id`（详情）/ `DELETE /sessions/:id`（删除）——会话历史从"后端文件"变成"产品功能" |
| refine（行程修改） | 注入"旧行程 JSON + 修改指令"重跑同一个图——修改与规划共用一套 agent→tools→planner→executor→validator 收口 |
| 旧数据兼容 | Phase 11 前保存的会话只有行程概要——refine 返回 400、detail 页按概要重新生成（降级而非崩溃） |

### 如果不用它？

"改行程"只能靠重新规划：Agent 会丢掉原行程里用户满意的部分，且无法演示"用户反馈驱动的再规划"——而这正是 Agent 区别于普通接口的核心能力（**人类反馈进入 Agent 循环**）。

---

## 3. 核心概念

- **用户触发的 re-plan**（本阶段核心技术，面试题）：Phase 06 的 re-plan 由 validator 触发（规则发现错误→反馈→重新生成）；refine 由用户触发（用户提指令→重跑图）。两者对称：**触发者不同，收口相同**——都走同一个图、同一套校验、同一个 SSE 轨迹协议。
- **约束层级**：refine 的 constraints 取旧行程——天数不变、预算作为**上限**（不是固定值）。所以"压缩预算"可行（新预算 ≤ 上限即合法），"提高预算/改天数"被约束拦下。实测：模型两次拒绝违反约束的用户指令（见 11.3）。
- **旧会话的优雅降级**：`tripPlan.plan` 不存在（Phase 11 前只存概要）→ refine 400（提示"先规划一次"）、detail 恢复时按概要重新生成。**新代码不要求旧数据配合**，这是向后兼容的基本功。
- **prompt 单一事实来源**：`TOOL_PROTOCOL`（工具协议）与 `SCHEMA_SPEC`（JSON 结构模板）从 getTravelPrompt 抽成模块常量，recommend 与 refine 共用——两份 prompt 的结构要求不会漂移。
- **测试隔离的 SESSIONS_FILE**：StateManager 支持 `SESSIONS_FILE` 环境变量覆盖持久化文件路径——API 测试用临时文件起真实服务，不污染运行时数据、不用 mock HTTP 层。

---

## 4. 本阶段不学习什么

- 不做分页/搜索/筛选（30 个会话规模下全量返回足够；生产演进路径：`listSessions` 加 offset/limit）
- 不做轨迹回放（Phase 10 已定：轨迹是运行时视图，会话只恢复 history + tripPlan）
- 不做多会话并行管理（单用户学习项目）
- 不做用户登录/鉴权（会话 ID 即身份，Phase 08 的克制原则延续）
- 不解决"改天数"（validator 要求 plan.days 与 constraints.days 一致，refine 天数不可变——约束语义如此，见 12 踩坑 3）

---

## 5. 当前代码状态（Phase 10 结束时）

```text
后端：stateManager.setTripPlan 只存行程概要（city/days/totalBudget）；
      无 sessions 相关路由；无 /refine
前端：detail 页行程生成后不可修改（无入口）；
      chat 页无行程横幅；profile 页无会话列表；
      且有一个 Phase 10 遗留的展示 bug：done 后轨迹不清空，
      v-else-if 链导致行程卡片永远不渲染
```

---

## 6. 本阶段目标架构

```text
后端
stateManager
  setTripPlan  存完整 plan（摘要字段保留，chat 系统提示仍用）
  listSessions 元数据 + 最近一条用户消息预览，按 updatedAt 降序
  deleteSession 删除 + 持久化（幂等：不存在返回 false → 路由 404）
travelService
  refine(sessionId, instruction, onEvent)：getRefinePrompt（旧行程 JSON +
    修改指令）→ streamGraph 重跑 → setTripPlan 覆盖 + recordUsage('refine')
  抽取 streamGraph（recommendStream 与 refine 共用流式消费）
  抽取 TOOL_PROTOCOL / SCHEMA_SPEC 常量（prompt 单一事实来源）
routes
  GET /sessions、GET /sessions/:id（404）、DELETE /sessions/:id（404）
  POST /refine（SSE，事件协议同 /recommend/stream；无完整行程 → 400）

前端
PlanContextBar  chat 页顶部横幅："当前行程：杭州 · 2 天 · 预算 1500 元" → detail
chat.vue        ?sessionId&restore=1 恢复历史消息；进入时拉取会话展示横幅
detail.vue      ?sessionId 恢复行程（旧会话按概要重新生成）；
                底部操作栏：追问行程（→chat）/ 修改行程（action-sheet 模板+输入）
                → streamPost('refine') → 轨迹重放 → done 替换行程
profile.vue     会话列表：swipe-cell 右滑删除 + dialog 确认 + 空态；
                点击 → /chat?sessionId&restore=1
```

---

## 7. 文件变化

### 新增

```text
travel-recomend-front/src/components/PlanContextBar.vue    # chat 页行程横幅
travel-recomend-backend/src/__tests__/refine.test.js       # 4 个 refine 服务测试
travel-recomend-backend/src/__tests__/sessionApi.test.js   # 7 个会话 API 测试（真实服务 + 临时文件）
```

### 修改

```text
travel-recomend-backend/src/services/stateManager.js   # 完整 plan 存储 / listSessions / deleteSession / SESSIONS_FILE
travel-recomend-backend/src/services/travelService.js  # refine / streamGraph / SCHEMA_SPEC 抽取 / chat 提示词
travel-recomend-backend/src/routes/travel.js           # /refine + /sessions 三个路由
travel-recomend-backend/src/__tests__/stateManager.test.js  # +3 个新方法测试
travel-recomend-front/src/views/detail.vue             # 修改行程弹层 + 会话恢复 + 轨迹清空修复
travel-recomend-front/src/views/chat.vue               # 会话恢复 + 行程横幅
travel-recomend-front/src/views/profile.vue            # 会话历史列表
travel-recomend-front/src/utils/request.ts             # +del helper
```

---

## 8. 关键代码

### 8.1 refine：用户触发的 re-plan（与 Phase 06 对称）

```js
// src/services/travelService.js（节选）
async refine(sessionId, instruction, onEvent) {
    const session = stateManager.getSession(sessionId)
    if (!session?.tripPlan?.plan) {
        throw new Error('该会话没有可修改的行程（请先规划一次）')
    }
    const oldPlan = session.tripPlan.plan

    const finalState = await this.streamGraph({
        messages: this.getRefinePrompt(oldPlan, instruction),
        // 约束取旧行程：天数不变；预算作为上限（用户可要求压缩预算）
        constraints: { budget: oldPlan.totalBudget, days: oldPlan.days },
        agentIterations: 0,
        replanCount: 0
    }, onEvent)

    const plan = finalState?.plan
    const usage = sumMessagesUsage(finalState?.messages ?? [])
    stateManager.setTripPlan(sessionId, plan)          // 新行程覆盖旧行程
    stateManager.recordUsage(sessionId, 'refine', usage)
    return { plan, usage }
}
```

**解释**：refine 不新增任何图节点——**换初始消息，重跑同一个图**。这是 LangGraph 架构的红利：编排逻辑（循环、校验、re-plan）与业务输入（初始消息）解耦。修改同样强制走工具轮（图对 agent 首轮 tool_choice=required），所以修改也基于真实资料。

### 8.2 refine 的初始消息：旧行程 + 指令

```js
// src/services/travelService.js（节选）
getRefinePrompt(oldPlan, instruction) {
    return [
        new SystemMessage(TOOL_PROTOCOL),           // 与 recommend 同一份
        new HumanMessage(`用户之前规划过以下行程：

${JSON.stringify(oldPlan, null, 2)}

用户希望这样修改：${instruction}

请先调用工具重新获取${oldPlan.city}的真实资料（get_weather 1 次 + search_attractions 最多 2 次），
然后在保留原行程合理部分的基础上落实修改要求，生成一份新的完整行程规划。
约束：天数保持 ${oldPlan.days} 天不变；总预算不得超过 ${oldPlan.totalBudget} 元。
…`)
    ]
}
```

**解释**：旧行程以 JSON 原文注入（不是摘要）——模型能"看到"它要改的对象；约束行把修改的自由度明确框住（天数不变、预算只降不升）。

### 8.3 会话元数据列表（服务端组装，前端零计算）

```js
// src/services/stateManager.js（节选）
listSessions() {
    return [...this.sessions.values()]
        .map(session => {
            const lastUser = [...(session.history ?? [])].reverse().find(m => m.role === 'user')
            return {
                sessionId: session.sessionId,
                updatedAt: session.updatedAt,
                messageCount: session.history?.length ?? 0,
                hasPlan: Boolean(session.tripPlan?.plan),   // 有"完整行程"才可恢复/修改
                city: session.tripPlan?.city ?? null,
                preview: lastUser ? lastUser.content.slice(0, 30) : ''
            }
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
```

### 8.4 前端修改行程（与规划共用同一条流式链路）

```ts
// src/views/detail.vue（节选）
const submitRefine = async () => {
    traceEvents.value = []
    traceRunning.value = true
    await streamPost('refine', { sessionId: sessionId.value, instruction }, (event) => {
        if (event.type === 'node') {
            traceEvents.value.push(event as TraceEvent)
        } else if (event.type === 'done') {
            tripData.value = event.plan
            usage.value = event.usage ?? null
            traceEvents.value = []          // 轨迹完成使命，替换为行程
        } else if (event.type === 'error') {
            throw new Error(event.message || '修改失败')
        }
    })
    // 修改失败：errMessage 置错误信息，旧行程保留展示（tripData 不动）
}
```

---

## 9. 完整数据流

```text
profile 页会话列表
  → 点击 → /chat?sessionId&restore=1 → GET /sessions/:id → 历史消息 + 横幅
  → 横幅"查看" → /detail?sessionId → GET /sessions/:id
      ├─ tripPlan.plan 存在 → 直接渲染行程
      └─ 只有概要（旧会话）→ 按概要重新生成
  → "修改行程" → action-sheet 输入指令 → POST /refine（SSE）
      → 后端注入旧行程 JSON + 指令重跑图（agent 工具轮 → planner → executor → validator）
      → 前端轨迹重放 → done 替换行程（新行程已覆盖写回会话）
  → "追问行程" → /chat（横幅展示当前行程；chat 只回答、不修改）
  → 右滑删除 → DELETE /sessions/:id → 列表刷新（磁盘同步删除）
```

---

## 10. 运行方式

```bash
cd travel-recomend-backend && npm test     # 80 个测试
cd travel-recomend-front && npm run build  # TS + 构建
# 后端 npm run dev + 前端 npm run dev，浏览器走一遍：
# 首页 → 开始规划（轨迹）→ 底部"修改行程"→ 选模板/输入指令 → 轨迹重放 → 新行程
# → "追问行程"→ chat 顶部横幅 → 我的页 → 会话列表 → 点击恢复 → 右滑删除
```

```bash
# 会话 API：
curl http://127.0.0.1:3300/api/travel/sessions                # 列表
curl http://127.0.0.1:3300/api/travel/sessions/<id>           # 详情（404 处理）
curl -X DELETE http://127.0.0.1:3300/api/travel/sessions/<id> # 删除
# 修改行程（SSE，事件协议同 /recommend/stream）：
curl -N -X POST http://127.0.0.1:3300/api/travel/refine \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"<id>","instruction":"把预算压缩 20%"}'
```

---

## 11. 测试

### 11.1 确定性测试（npm test，80/80）

```text
stateManager 新增（3 个）：
✔ setTripPlan 保存完整行程（refine 注入与 detail 恢复依赖）
✔ listSessions 按 updatedAt 降序返回元数据（含 hasPlan/preview/messageCount）
✔ deleteSession 删除并持久化；重复删除返回 false

sessionApi（7 个，真实服务 + SESSIONS_FILE 临时文件，零 LLM 调用）：
✔ GET /sessions 元数据列表（排序/字段/hasPlan 语义）
✔ GET /sessions/:id 返回完整会话（含 history 与行程）
✔ GET /sessions/:id 不存在 → 404
✔ DELETE /sessions/:id 删除并持久化到磁盘
✔ DELETE 不存在 → 404
✔ POST /refine 缺少参数 → 400
✔ POST /refine 旧会话（无完整行程）→ 400，且不调用 LLM

refine（4 个，stub LLM 驱动重跑图）：
✔ 注入旧行程 JSON + 修改指令；新行程写回会话；usage 按 'refine' 记账
✔ 强制重新 grounding：图仍先走工具轮（首轮带工具调用 + 工具协议在场）
✔ 无完整行程的会话抛明确错误（含旧格式只有概要的会话）
✔ 图节点抛错（max_iter）向上传播（路由层转 SSE error）
```

### 11.2 真实 API 实录（成功路径）

```text
1) 先规划（成都 1 天 500 元，创建带完整行程的会话）：
   节点序列：agent → tools ×3 轮 → agent（停止）→ planner → executor → validator（10 个事件）
   usage：输入 10147 + 输出 3498

2) refine「把预算压缩 20%，把上午的行程换成成都博物馆」：
   节点序列：agent → tools ×2 轮 → agent（停止）→ planner → executor → validator（8 个事件）
   done：totalBudget 500 → 400；morning.spot → 成都博物馆
   usage：输入 13337（旧行程 JSON + 重新 grounding 的开销）+ 输出 3811

3) 会话状态验证：tripPlan.plan 为新行程；usageLog 记账
   recommend | refine | refine | refine（4 条，kind 正确）
   会话列表该条目：hasPlan=true、city=成都、totalBudget=400
```

### 11.3 真实 API 实录（约束层级生效——两次"制造失败"都被拦下）

```text
refine「把预算提高到 3000 元」：
  结果：模型保持 totalBudget=400（≤ 上限 550），只调整了行程内容
refine「把行程改成 3 天」：
  结果：模型保持 days=1，正常 done
```

**解读**：prompt 中的约束行（"天数不变、预算不得超过 X"）压过了用户指令——这是约束层级的实证，也是 refine 语义（预算只降不升）在真实模型上的验证。refine 的失败路径（validator 失败 → re-plan → fail_validation / max_iter）由单测覆盖（stub 决策序列），真实模型很难被诱导违反约束——这本身是好消息。

---

## 12. 调试指南（本阶段真实踩坑）

### 踩坑 1：Phase 10 遗留的展示 bug——done 后行程卡片永远不渲染

现象：重构 detail 页模板时发现，Phase 10 提交的版本里 `TracePanel v-if="traceRunning || traceEvents.length"` 与 `<template v-else-if="tripData">` 构成互斥链——done 后 traceEvents 保留 8 个事件，轨迹面板继续渲染，行程卡片被 v-else-if 排除。
根因：Phase 10 的 done 处理器只设置 tripData，没有清空轨迹事件。
修法：done / error 后 `traceEvents.value = []`（轨迹是运行时视图，完成即退场）；同时把错误卡片从 v-else-if 链拆成独立 v-if——修改行程失败时**旧行程仍可看**，错误在上方提示。
收获：v-if / v-else-if 链的互斥语义要逐个分支推演终态；这类"成功却看不到结果"的 bug 不会在构建和单测中暴露，只会在真实点击链路中暴露——**本阶段再次印证：接口层与展示层的语义需要端到端手测**。

### 踩坑 2：SCHEMA_SPEC 抽取时的转义事故

现象：把 JSON 模板从 getTravelPrompt 抽成常量时，模板字符串里的 `\"约2小时\"` 被多写了一层反斜杠（`\\"`），prompt 里会渲染出字面反斜杠。
修法：模板字符串中 `\"` 渲染为 `"`，`\\"` 渲染为 `\"`——写完后用 node 读字节 + import 模块双重验证，并顺手把最易出错的 ticket 行改成无引号写法（`如60元或免费`），语义不变、彻底消灭转义。
收获：抽取 prompt 常量时必须**验证渲染结果**（打印真实 prompt 文本），语法通过 ≠ 内容正确。

### 踩坑 3：refine 的约束语义被真实模型"证明"了

现象：想录一条 refine 失败路径（超预算指令触发 validator→re-plan），两次尝试（"提高到 3000 元""改成 3 天"）模型都遵守约束、正常 done。
收获：这暴露了一个产品语义问题——**refine 不支持改天数、不支持加预算**，而前端快捷模板必须与约束对齐（所以模板是"压缩预算"而非"提高预算"）。失败路径的确定性验证交给 stub 单测（max_iter 传播、re-plan 序列），真实实录如实记录"约束生效"而非硬造失败。已在 Backlog 记录"改天数/加预算"的未来选项。

### 踩坑 4：hasPlan 的语义翻车（测试先于文档）

现象：stateManager 单测里想模拟"Phase 11 前的旧会话"，用 `setTripPlan` 传了一个只有摘要的对象——结果 `hasPlan=true`。
根因：setTripPlan 现在**总是**存完整 plan（传进去的对象就是 plan 字段）。模拟旧格式必须直接改 `session.tripPlan` 字段。
收获：字段语义（hasPlan = "有完整行程"而非"有行程概要"）要在测试里用真实的数据形态表达；listSessions 排序测试改用固定时间戳（真实时间戳可能同毫秒，排序断言会抖动）。

---

## 13. 常见错误

- 把 refine 做成"只改文本"的接口——修改必须重跑图，走工具 grounding 与校验收口
- 新代码要求旧数据配合——旧会话没有完整行程，要有 400/重新生成两条降级路径
- refine 的约束取"当前指令值"而非旧行程——约束错了，validator 就拦不住越界
- 快捷模板与约束语义打架（如"改成 3 天"模板）——模板要与后端约束对齐
- 会话列表把整个行程下发——列表要元数据 + 预览，详情才给全量
- 忘记"删除要持久化"——deleteSession 不写盘，重启后会话复活

---

## 14. 和上一阶段的关系

Phase 10 让"过程"可见，Phase 11 让"过程"可被用户**反馈**：轨迹可视化是单向展示（后端→前端），refine 是双向交互（用户指令→Agent 重跑→新轨迹）。两者组合成完整的演示闭环：规划（轨迹）→ 修改（轨迹重放）→ 历史（会话管理）。面试演示时建议按这个顺序讲——先展示 Agent 的自主性，再展示**人类反馈如何进入 Agent 循环**（refine 是这个项目里唯一的人工介入点）。

---

## 15. 面试问题（附参考回答）

### 基础

**Q1：用户说"把第二天改成西湖"，你的系统怎么处理？**

参考回答：这是 refine 接口。前端把指令发给 `POST /refine`（带 sessionId），后端取出该会话的完整行程，构造初始消息 = 工具协议 + 旧行程 JSON + 修改指令，**重跑同一个 LangGraph 图**——agent 先重新调工具（天气 + 景点检索，修改也基于真实资料），然后 planner 出新大纲、executor 生成新行程、validator 校验。约束取旧行程：天数不变、预算作为上限。新行程覆盖写回会话，前端轨迹面板重放整个决策过程。

**Q2：refine 和重新规划有什么区别？为什么不直接让用户重新规划？**

参考回答：三处不同：① 输入不同——refine 把旧行程 JSON 完整注入上下文，模型能看到"要改的对象"，会保留原行程的合理部分；重新规划则从零开始。② 约束不同——refine 的约束锚定旧行程（天数不变、预算上限），重新规划的约束来自用户输入。③ 体验不同——refine 是"修改"，用户期望的是最小变更；重新规划会丢失用户已认可的部分。技术实现上两者共用同一个图和同一套校验——这是"换初始消息而非换编排"的红利。

**Q3：旧版本保存的会话（没有完整行程）怎么兼容？**

参考回答：两层降级：refine 端——`tripPlan.plan` 不存在时返回 400 和明确提示（"请先规划一次"）；detail 恢复端——只有概要时按概要（city/days/budget）自动重新生成一次。原则是**新代码不要求旧数据配合**：数据迁移或兼容逻辑放在读取侧，用存在性判断分支，而不是要求所有旧数据升级。

### 项目实践

**Q1：为什么修改行程也要重新调用工具？旧行程里不是已经有资料了吗？**

参考回答：因为修改的目标可能正是资料相关的（"换个景点"），而知识库会更新（新景点、价格变化）。强制重新 grounding 的成本是可见的（实测 refine 输入约 13K token，比纯规划多约 30%），但收益是修改结果与规划结果一样有据可查。如果未来要省成本，可以把"重新检索"做成可选项——但当前正确性优先。

**Q2：chat 追问和 refine 修改是怎么分工的？**

参考回答：chat 只回答、不修改——它的系统提示会基于当前行程回答问题，用户提出修改要求时它会指路到详情页的「修改行程」。refine 只修改、不闲聊——它没有多轮对话能力，每次执行都是"旧行程 + 一条指令 → 新行程"。这样分工的原因：修改需要走完整校验收口（schema + 语义规则），chat 的自由对话无法保证这一点；反过来，追问需要多轮记忆与自然表达，图的固定编排不合适。

**Q3：会话列表为什么服务端组装元数据，而不是把整个会话下发？**

参考回答：列表场景只需要标识信息（城市、天数、预算、最近一条消息预览）——全量下发行程与历史会浪费移动端带宽与解析成本，而且列表的排序/字段逻辑服务端一次实现、多端复用。详情接口（`GET /sessions/:id`）才给全量。这是 API 设计的基本粒度原则：列表瘦、详情全。

### 深挖

**Q1：用户触发的 re-plan 和 validator 触发的 re-plan 有什么本质区别？**

参考回答：触发者不同、语义不同、循环边界不同。validator 触发的是**自动纠错**——同一个任务内、规则发现错误、反馈自动生成、只允许一次（防止死循环），失败即抛错；refine 是**任务级再执行**——用户带着新意图启动一次全新的图执行，约束从旧行程派生，没有次数上限（用户可以反复改）。共同点：两者都通过"反馈消息注入 → executor 重新生成"这个机制实现，这正是 LangGraph 状态图的价值——同一条边（replan_feedback → executor）和同一套节点，既服务自动纠错也服务人工反馈。

**Q2：用户指令和系统约束冲突时怎么办？你的实测结果是什么？**

参考回答：约束优先，且实测证明了这一点：我试过"把预算提高到 3000 元"（约束上限 550）和"把行程改成 3 天"（约束天数 1），真实模型两次都遵守了约束，只在约束内调整内容。设计上这是故意的——refine 的约束语义是"预算只降不升、天数不变"，因为预算上限和天数是规划成立的前提（validator 按约束校验）。但如果产品确实需要"改天数"，正确做法不是放松约束，而是让约束**跟随指令更新**（从指令中解析新的天数/预算，或让用户显式选择）——这需要指令解析或结构化输入，是本项目的 Backlog 项。

**Q3：会话数据用 JSON 文件存，列表/删除会有并发问题吗？**

参考回答：当前单进程、单用户、低频写——每次变更同步写盘，没有并发窗口。规模化的演进路径：多进程/多实例时需要数据库或文件锁（Node 单进程内的 Map 天然串行）；分页（listSessions 目前全量返回，30 个会话没问题，上千个就要 offset/limit + 索引）；删除的软删/回收站（审计需求）。这些问题的**答案都写在克制原则里**：先回答"如果不用它会怎样"，现在的规模用 JSON 文件就是正确答案。

---

## 16. 毕业检查

### 代码

- [x] setTripPlan 存完整 plan；listSessions / deleteSession（含 SESSIONS_FILE 测试隔离）
- [x] refine：注入旧行程 + 指令重跑图；约束取旧行程；新行程覆盖写回 + usage('refine')
- [x] GET /sessions、GET /sessions/:id（404）、DELETE /sessions/:id（404）、POST /refine（400 降级）
- [x] SCHEMA_SPEC / TOOL_PROTOCOL 抽取（prompt 单一事实来源）
- [x] 前端：PlanContextBar + chat 恢复 + detail 修改行程（模板+弹层）+ profile 列表（右滑删除）
- [x] Phase 10 展示 bug 修复（done 后清空轨迹，错误卡片独立 v-if）
- [x] 14 个新测试，全量 80/80；前端构建通过
- [x] 真实实录：refine 成功（预算 500→400 + 景点替换）+ 约束生效双录 + 会话 API 实录
- [x] 没有实现下一阶段内容（无分页/鉴权/轨迹回放）

### 理解

- [ ] 我能讲清"用户触发 re-plan 与 validator 触发 re-plan"的对称与区别
- [ ] 我能解释 refine 的约束为什么取旧行程、为什么"改天数"当前不可行
- [ ] 我能讲清旧会话的两条降级路径（refine 400 / detail 重新生成）
- [ ] 我能回答"修改行程为什么要重新调工具"（成本与正确性的权衡）
- [ ] 我能回答"面试问题"章节的全部问题

### 用户确认

```text
User Confirmation: PENDING
```

---

## 17. 本阶段总结

### 我学会了

- 用户触发的 re-plan：换初始消息重跑同一个图（编排与输入解耦的红利）
- 约束层级的设计与实测验证（系统约束压过用户指令）
- 旧数据兼容的两条降级路径（400 / 按概要重新生成）
- 会话数据的 API 化：列表瘦（元数据+预览）、详情全、删除要持久化
- prompt 常量抽取与"验证渲染结果"的意识
- 前端 v-if/v-else-if 链的终态推演（Phase 10 bug 的教训）

### 我还不会

- 指令解析/NLU（从自然语言指令中提取结构化参数）——需要时可用工具调用实现
- 会话数据的分页与并发控制（当前规模不需要）
- 多用户会话隔离与鉴权

### 下一阶段

```text
模拟面试（Phase 09 遗留，两轮）+ 面试冲刺
```
