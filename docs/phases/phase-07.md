# Phase 07 — LangGraph

## 1. 本阶段目标

本阶段结束后，我能够：

> 把 Phase 03-06 手写的 Agent 编排重写为 LangGraph 图结构，并能回答"框架替我做了什么、代价是什么、什么时候不该用框架"。

---

## 2. 为什么学习这个？

### 上一阶段遗留的问题

Phase 03-06 的编排是**手写过程式代码**：`while` 循环 + `if` 分支 + 函数调用链。它完全可用，但有三个结构性问题：
1. **流程不可视**：执行路径藏在代码里，只有日志能复盘，没有"图"可以看
2. **状态隐式**：messages 数组在函数间传来传去，状态字段和流转规则没有显式定义
3. **不可持久化**：执行到一半服务挂了，整个请求状态丢失，无法恢复

### 新技术解决什么问题？

LangGraph 把编排声明为**图**：节点（Node）= 计算步骤，边（Edge）= 流转规则，状态（State）= 跨节点共享数据。

| 手写实现的问题 | LangGraph 的答案 |
|---|---|
| 流程不可视 | 图结构本身即文档；条件边把"为什么这样走"写成声明 |
| 状态隐式 | `Annotation.Root` 显式声明每个字段及其合并规则 |
| 不可持久化 | checkpointing 机制（本阶段未启用，概念见 §15） |

**但本阶段最核心的学习目标不是"会用 LangGraph"，而是通过重写回答一个问题：框架替你做了什么？** 手写过一遍再上框架，你才能看到：循环变成了两条边、终止条件变成了条件边路由、max_iter 变成了一个失败节点——**框架没有创造新能力，只是把过程式控制流变成了声明式结构**。面试官问"为什么用 LangGraph"时，这个对比就是答案。

### 如果不用它？

面试官问"你为什么用 LangGraph"时没有真实答案，只能背诵官方话术——**这就是最容易"看起来高级但被问穿"的技术**。本阶段的毕业标准就是回答这个问题。

---

## 3. 核心概念

- **Node（节点）**：一个计算步骤。本项目：agent / tools / planner / executor / validator / replan_feedback
- **Edge（边）**：节点间的流转。固定边（`tools → agent`）+ **条件边**（`agent` 之后根据 tool_calls 决定去向）——条件边是 Agent 图的核心
- **State（图状态）**：`Annotation.Root` 声明的共享数据结构，节点返回部分更新，图自动合并。注意与 Phase 04 的会话 State 区分：**图状态是单次图执行内的**，会话状态是跨请求的
- **reducer**：状态字段的合并规则。messages 用 `messagesStateReducer`（追加语义），计数器用默认覆盖
- **循环**：图上就是两条边——`agent → tools → agent` 和 `replan_feedback → executor`。while 循环在图里没有特殊语法，边指回去就是循环
- **checkpointing（概念）**：图执行状态的快照机制，支持断点恢复/人工介入/时间旅行。本阶段刻意不启用（理由见 §15）

---

## 4. 本阶段不学习什么

- 不启用 checkpointing/persistence——概念理解即可，本项目无断点恢复需求
- 不学子图（subgraph）嵌套——单图足够
- 不学 LangGraph Platform/Studio——云服务与学习目标无关
- 不学多 Agent 图（supervisor 模式）——面试前不做
- 不改 chat 流程——chat 是单步流式，图化无收益（这也是"什么时候不用框架"的答案素材）

---

## 5. 当前代码状态（Phase 06 结束时）

```text
travelService.recommend：
  runAgentLoop（while 循环 + max_iter 兜底）
  → generatePlanWithReflection（Planner→Executor→Validator→re-plan）
过程式编排，状态靠函数参数传递。
```

---

## 6. 本阶段目标架构

```text
                    ┌──────────┐
                    │  START   │
                    └────┬─────┘
                         ▼
                    ┌─────────┐     无 tool_calls（自主终止）
             ┌─────▶│  agent  │────────────────────┐
             │      └────┬────┘                    │
             │    有 tool_calls                     │
             │   轮数 < 5  ▼                        ▼
             │      ┌─────────┐              ┌──────────┐
             └──────│  tools  │              │ planner  │──▶ executor ──▶ validator
   （循环 = 两条边） └─────────┘              └──────────┘               │
             │                                          ┌───────────────┤
             │  有 tool_calls 且轮数 ≥ 5                 │ 失败且未 re-plan │ 通过
             ▼                                          ▼               ▼
      ┌──────────────┐                         ┌────────────────┐     END
      │ fail_max_iter│（抛错 → 500）            │ replan_feedback │
      └──────────────┘                         └───────┬────────┘
                                                       │ 回 executor（循环边）
                                                       │
                                           失败且已 re-plan → fail_validation（抛错 → 500）
```

---

## 7. 文件变化

### 新增

```text
travel-recomend-backend/src/graphs/travelAgentGraph.js   # 图定义（8 节点 + 4 条件边路由）
```

### 修改

```text
travel-recomend-backend/src/services/travelService.js
    # 删除 runAgentLoop / generatePlanWithReflection（移入图）
    # recommend 改为：准备初始状态 → graph.invoke → 返回 result.plan
    # 保留 generateOutline / validatePlanWithRetries（图的节点内部使用）
travel-recomend-backend/package.json
    # 新增依赖 @langchain/langgraph（ROADMAP Phase 07 点名）
```

**没有修改任何测试**——Phase 03-06 的 48 个测试原样通过，这就是重写可信度的证据。

---

## 8. 关键代码

### 8.1 状态声明（显式的状态契约）

```js
// src/graphs/travelAgentGraph.js（节选）
const AgentState = Annotation.Root({
    // messagesStateReducer：节点只返回"新增消息"，图自动追加
    messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
    constraints: Annotation({ default: () => ({ budget: 0, days: 1 }) }),
    agentIterations: Annotation({ default: () => 0 }),   // max_iter 计数器
    outline: Annotation({ default: () => null }),        // 大纲
    plan: Annotation({ default: () => null }),           // 最终行程
    validationErrors: Annotation({ default: () => null }),
    replanCount: Annotation({ default: () => 0 })
})
```

**解释**：手写版的"messages 在函数间传来传去"变成了显式状态字段。每个字段的默认值与合并规则一目了然——这就是"状态显式化"。

### 8.2 循环变成两条边

```js
.addEdge('tools', 'agent')                    // 循环边 1：执行完工具回到 agent 再决策
.addEdge('replan_feedback', 'executor')       // 循环边 2：校验失败反馈回流重新生成
```

**解释**：手写版的 `while (tool_calls && iter < max)` 在图上没有对应语法——边指回去就是循环。终止条件变成了条件边的路由函数：

```js
function routeAfterAgent(state) {
    const last = state.messages[state.messages.length - 1]
    if (last?.tool_calls?.length) {
        if (state.agentIterations >= MAX_AGENT_ITERATIONS) return 'fail_max_iter'  // 兜底
        return 'tools'                                                             // 继续循环
    }
    return 'planner'                                                               // 自主终止
}
```

### 8.3 失败节点

```js
function failMaxIterNode() {
    throw new Error(`Agent 达到最大迭代次数（${MAX_AGENT_ITERATIONS} 轮）仍未停止工具调用`)
}
```

**解释**：手写版的 `throw` 原样保留——失败策略不变，只是从"循环结束后的判断"变成了"图上的一个节点"。错误信息一字未改，所以 Phase 03 的 max_iter 测试原样通过。

### 8.4 recommend 变成三行

```js
const result = await this.graph.invoke({
    messages: this.getTravelPrompt(city, budget, days),
    constraints: { budget, days },
    agentIterations: 0,
    replanCount: 0
})
const plan = result.plan
```

**解释**：service 只负责准备初始状态和收尾（会话保存），编排完全交给图。节点在运行时通过 `service.toolLlm` 访问 LLM——所以测试注入 stub 的机制也原样可用。

---

## 9. 完整数据流

```text
User → recommend
  ▼
初始状态 {messages, constraints, agentIterations:0, replanCount:0}
  ▼ graph.invoke
START → agent（required 强制 grounding）
  ├─ 有 tool_calls → tools（执行）→ agent（auto）→ …… ← 循环边
  │    轮数 ≥ 5 仍在调工具 → fail_max_iter 抛错（500）
  └─ 无 tool_calls → planner（大纲，可降级）→ executor（完整行程 + 格式重试）
        → validator（语义校验）
            ├─ 通过 → END → result.plan
            └─ 失败 → replan_feedback（错误反馈）→ executor ← 循环边（仅 1 次）
                  → validator 再判：通过 → END / 失败 → fail_validation 抛错（500）
  ▼
recommend 拿 result.plan → setTripPlan → 返回前端
```

---

## 10. 运行方式

```bash
cd travel-recomend-backend
npm install    # 新增 @langchain/langgraph
npm test       # 48 个测试（Phase 03-06 的测试原样通过）
npm run dev
```

日志关键行：`[Graph/agent]` / `[Graph/tools]` / `[Graph/planner]` / `[Graph/validator]` / `[Graph/replan]`——图执行轨迹直接可见。

---

## 11. 测试

### 11.1 行为等价性验证（本阶段最重要的测试证据）

```text
Phase 03-06 的 48 个测试一个没改，全部通过：
✔ 多轮循环：模型连续 2 轮请求工具后自主停止
✔ max_iter 兜底：模型无限请求工具 → 抛明确错误
✔ 工具执行失败后循环继续：模型下一轮换参数重试
✔ 校验失败 → re-plan 一次 → 修复成功
✔ re-plan 后仍不通过 → 抛明确错误
✔ 大纲生成失败 → 降级跳过规划
（以及全部 validator / 状态 / 检索 / 工具测试）
```

**这组测试就是"重写正确性"的证明**：图实现与手写实现对外行为完全一致。重写一个系统最可靠的方式不是"再写一遍测试"，而是"让旧测试原样通过"。

### 11.2 真实调用实录（图执行轨迹）

```text
POST 西安 2 天 1800 元 → HTTP 200
[Graph/agent] 第 1 轮：2 次工具调用 get_weather, search_attractions
[Graph/tools] get_weather({"city":"西安"}) 执行结果：晴 26℃
[Graph/tools] search_attractions({"query":"西安热门景点"}) → 兵马俑（embedding）
[Graph/agent] 第 2 轮：1 次工具调用（搜索钟楼鼓楼——知识库未收录）
[Graph/agent] 第 3 轮：1 次工具调用（换关键词再搜）
[Graph/agent] 第 4 轮：1 次工具调用
[Graph/agent] 第 5 轮：0 次工具调用 （模型停止请求工具）
[Graph/planner] 行程大纲生成成功
[Graph/validator] 行程校验通过
```

注意：这次模型在"搜不存在的景点"上花了 4 轮，在第 5 轮自主停止——**和 Phase 03 手写版的行为完全一致**（含检索预算约束下的边际行为）。

---

## 12. 调试指南（本阶段真实踩坑）

### 踩坑 1：MESSAGE_COERCION_FAILURE——reducer 对消息类型是严格的

现象：重写后一跑测试，LangGraph 抛 `MESSAGE_COERCION_FAILURE`，错误里显示收到了 `{"content": "..."}`。
根因：`messagesStateReducer` 要求增量消息是真正的 BaseMessage；测试 stub 返回普通 `{content}` 对象（真实 LLM 返回 AIMessage 所以生产没这个问题），手写版直接 push 进数组从不校验，图却会强制转换。
修法：图模块加 `toMessage()` 包装——节点出口的所有消息统一转换。这暴露了一个真实差异：**手写版的数组是"无类型"的，图的 State 是"有契约"的**——框架把隐式约束变成了显式报错。
收获：框架的严格性是有价值的——它逼你在边界处明确类型，而不是让脏数据静默流转。

### 踩坑 2：图构建时机与测试注入的兼容

现象：如果图在构造函数里**捕获** `this.toolLlm` 的引用，测试在构造后替换 `service.toolLlm` 就失效了。
修法：节点函数在**运行时**通过 `service.xxx` 动态访问，图只捕获 service 本身。生产上这还带来一个好处：LLM 实例可以热替换。
收获：闭包捕获（值）与运行时查找（引用）的区别，在依赖注入场景下是设计决策。

### 踩坑 3：条件边路由函数的返回值是"下一个节点名"

现象：把条件边写成了"边"（addEdge），图直接线性执行，循环没了。
修法：`addConditionalEdges(node, (state) => 'tools' | 'planner' | 'fail_max_iter')`——返回的是节点名字符串。工具循环、re-plan 回流都是条件边 + 固定边的组合。
收获：图的核心心智模型：**节点做计算，边做决策**。所有"接下来去哪"的逻辑都应该在边（路由函数）里，而不是节点内部。

---

## 13. 常见错误

- 为用框架而用框架——chat 这种单步流式场景图化没有收益，我们刻意没改
- 图上再写一遍 while 循环——循环应该用"边指回去"表达
- 图状态和会话状态混为一谈——图状态单次执行内有效，会话状态跨请求
- 忽略 reducer 的语义——messages 用追加 reducer，计数器用覆盖，混用会出幽灵状态
- 重写时顺手改行为——本阶段的原则是"行为不变只换编排"，48 个旧测试就是护栏

---

## 14. 和上一阶段的关系

Phase 06 的 plan-then-execute + Reflection 逻辑**一行没删**——它们从 service 的方法变成了图的节点（planner/executor/validator/replan_feedback）。Phase 03 的 Agent Loop 从 while 循环变成了两条边 + 一个条件路由。**框架没有创造新能力，只是把过程式控制流变成了声明式结构**——这句话就是本阶段的全部学习成果，也是面试的核心答案。

下一阶段（Phase 08 — Eval & Hardening）：给整个系统建评估集（≥15 用例 + rubric）、错误处理与成本控制的收口、日志与观测。这是面试差异化最强的阶段。

---

## 15. 面试问题（附参考回答）

### 基础

**Q1：为什么使用 LangGraph？手写循环不够吗？**

参考回答：手写完全够——我的项目 Phase 03-06 就是手写的，功能全部可用。LangGraph 解决的是**工程化**问题：① 流程可视化——执行路径从"藏在代码里的 while/if"变成"显式节点和条件边"，图本身就是文档；② 状态显式——每个状态字段、默认值、合并规则（reducer）声明在一处；③ 扩展点——checkpointing（断点恢复/人工介入）是图的天然能力，手写要做非常费劲。但我最想强调的是：**框架没有创造新能力**——我用同一套 48 个测试原样验证了重写的行为等价性，循环就是两条边，终止条件就是条件边路由。什么时候不用框架：单步流式对话（我的 chat 就没图化）、逻辑简单的线性流程。

**Q2：Node、Edge、State 分别是什么？**

参考回答：Node 是计算步骤（我的图有 agent/tools/planner/executor/validator 等 8 个节点）；Edge 是流转规则——固定边（tools→agent）和条件边（agent 之后根据 tool_calls 路由到 tools/planner/fail 三个去向）；State 是跨节点共享的数据，用 Annotation.Root 声明，节点返回部分更新，图按 reducer 合并（messages 是追加语义，计数器是覆盖语义）。

**Q3：什么是 checkpointing？你启用了吗？**

参考回答：checkpointing 是图执行状态的快照机制，每执行一个节点记录一次状态。它支持：断点恢复（执行到一半挂了，从快照继续）、人工介入（interrupt 暂停等审批再继续）、时间旅行（回滚到某个历史状态重新分支）。我的项目**刻意没启用**：单次请求 1 分钟内完成、无审批环节、无断点需求——概念我理解，启用是过度设计。面试官如果追问"什么场景该启用"：长时间任务、写操作需要人工确认的 Agent 工作流。

### 项目实践

**Q1：你的 Agent Loop 在图上是怎么表达的？**

参考回答：循环就是两条边——`tools → agent` 指回去，模型每轮决策后要么再进 tools、要么路由到 planner 结束循环。终止条件在条件边路由函数里：无 tool_calls → 自主终止；轮数达到 5 还在调工具 → 路由到失败节点抛错（和手写版同样的错误信息）。手写版的 while 循环 + max_iter 判断，在图上是"两条边 + 一个路由函数"——这是我把控制流翻译成图的最直观案例。

**Q2：重写的时候你怎么保证行为不变？**

参考回答：**让旧测试原样通过**。Phase 03-06 的 48 个测试一个没改，全部通过——包括 max_iter 兜底、失败恢复、re-plan、大纲降级。重写正确性的最高标准不是"新测试全过"，而是"旧测试不用改"。过程中踩过一个真实的坑：手写版的 messages 数组是无类型的，图的 reducer 有严格的消息类型契约，测试 stub 的普通对象被拒收——这个报错本身证明了框架的"状态显式化"价值。

**Q3：图状态和你 Phase 04 的会话状态是什么关系？**

参考回答：两个层面，互不替代。图状态（Annotation.Root）是**单次图执行内**的共享数据——messages、迭代计数、大纲、最终行程，请求结束就消失；会话状态（StateManager）是**跨请求**的——对话历史、行程草案，JSON 持久化。图执行完，result.plan 被写入会话状态，两者在 recommend 的收尾处交汇。面试常问的 State 概念，我项目里恰好有这两个层次的真实实现。

### 深挖

**Q1：LangGraph 的 reducer 机制解决了什么问题？**

参考回答：并行节点更新同一字段时的合并冲突。比如 messages：多个节点同时返回新消息，按什么顺序合并？`messagesStateReducer` 定义了追加语义。我的图里没有并行节点，所以 reducer 只是"追加"与"覆盖"的区别——但概念上它是图的并发模型的一部分。真实的并行场景：多工具并行执行后结果合并回 messages。

**Q2：什么时候不该用 LangGraph？**

参考回答：三个信号：① 流程是线性无分支的——图的收益为零；② 单步调用——比如我的 chat 流式对话，图化纯属仪式感；③ 团队不熟悉图模型——过程式代码更容易被读懂和维护时，可读性优先。我的原则：**先手写跑通，再考虑图化**——手写过才知道哪些结构值得图化（循环、条件路由、多步骤校验），哪些不值得（单步流式）。

**Q3：如果不用 LangGraph，你会用什么替代？**

参考回答：手写（Phase 03-06 就是证明）+ 状态机。图的核心价值其实是一个**显式状态机**：节点=状态、边=转移、条件边=守卫条件。用普通代码 + 清晰的状态对象也能达到同样效果，代价是可视化和 checkpointing 要自己做。所以选型问题不是"图 vs 代码"，而是"这些工程化能力值不值得引入一个框架"——我的答案：值得，因为它还带来了可讲的故事和可演进的扩展点。

---

## 16. 毕业检查

### 代码

- [x] 完整图：8 节点（agent/tools/planner/executor/validator/replan_feedback/fail×2）
- [x] 两条循环边（tools→agent、replan_feedback→executor）+ 两个条件路由
- [x] max_iter 兜底与校验失败策略原样保留（错误信息一字未改）
- [x] recommend 委托图执行（三行编排）
- [x] 48 个旧测试原样通过（行为等价性证明）
- [x] 真实调用图执行轨迹完整（5 轮循环 + planner + validator）
- [x] 没有实现下一阶段内容（无 checkpointing、无并行、无 eval 集）

### 理解

- [ ] 我能画出完整的图结构并解释每条边为什么存在
- [ ] 我能回答"框架替我做了什么"——循环→边、终止→路由、失败→节点
- [ ] 我能说出图状态与会话状态的区别（两个真实实现）
- [ ] 我能回答"什么时候不该用 LangGraph"
- [ ] 我能回答"面试问题"章节的全部问题

### 用户确认

```text
User Confirmation: PENDING
```

---

## 17. 本阶段总结

### 我学会了

- LangGraph 三要素：节点（计算）、边（流转）、状态（共享数据 + reducer）
- 把过程式控制流翻译成图：循环=边指回去，终止=条件路由，失败=节点
- 重写的行为等价性验证方法：旧测试原样通过
- 框架的严格性价值（reducer 的消息类型契约）
- "什么时候不该用框架"的判断标准

### 我还不会

- 系统性的评估集设计（Phase 08）
- 成本控制与观测（Phase 08）

### 下一阶段

```text
Phase 08 — Eval & Hardening
```
