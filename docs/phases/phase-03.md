# Phase 03 — Agent Loop

## 1. 本阶段目标

本阶段结束后，我能够：

> 亲手实现最小 Agent Loop，理解 Tool Call → Tool Result → LLM 的循环，并能解释终止条件与无限循环防护。

---

## 2. 为什么学习这个？

### 上一阶段遗留的问题

Phase 02 的 `recommend` 是"一轮工具调用 + 一轮答案"的**直线流程**：模型拿完工具结果必须立刻答题，没有"看了结果不满意，再查一次"的自由。遇到"第一次检索结果为空""工具返回的信息不够"这类情况，模型只能硬着头皮作答。

### 新技术解决什么问题？

Agent Loop 把直线变成**循环**——模型成为自主决策者：

| 能力 | 说明 |
|---|---|
| 多轮信息收集 | 模型可以反复"查 → 看 → 再查"，直到信息足够 |
| 自主终止 | 模型自己决定"信息够了，开始答题" |
| 失败恢复 | 工具返回错误/空结果时，模型在下一轮换策略重试 |
| 兜底保护 | max_iter 防止模型陷入无限循环烧 token |

**Agent 的定义**：能感知（工具结果）、思考（LLM 决策）、行动（发起工具调用）并循环执行直到任务完成的系统。**做完这个 Phase，你的项目才真正有资格叫 Agent。**

### 如果不用它？

- 一次检索失败 = 整个请求失败（无恢复能力）
- 模型永远只能"查一轮"，复杂任务做不了
- 面试官问"Agent 和 LLM Application 的区别"，你没有代码支撑

---

## 3. 核心概念

- **Agent Loop 的解剖**：Observe（工具结果）→ Think（LLM 决策）→ Act（发起工具调用）→ 循环
- **终止条件（两个，互为保险）**：
  1. 模型返回不含 tool_calls 的回答（自主终止）
  2. `MAX_AGENT_ITERATIONS`（兜底终止——模型陷入死循环时的安全阀）
- **max_iter 的价值**：把"无限烧 token"变成"明确失败"（24 秒 vs 无限）
- **tool_choice 分层**：第一轮 `required`（保证 grounding），后续轮次 `auto`（把"继续还是停止"的决定权还给模型）
- **检索预算**：在 prompt 里明确"每种工具调用几次就停"——控制收集癖，见 §12 踩坑 2
- **消息即状态**：messages 数组逐轮增长，就是 Agent 的状态载体（Phase 04 会正式化）

---

## 4. 本阶段不学习什么

- 不学跨会话状态持久化——messages 只在单次请求内存活（Phase 04）
- 不用 LangChain 的 AgentExecutor / createAgent 封装——**本阶段必须手写循环**，理解机制之后再谈框架（Phase 07 LangGraph）
- 不学多 Agent 协作、规划分解——Phase 06
- 不改前端——接口契约不变，前端无感

---

## 5. 当前代码状态（Phase 02 结束时）

```text
recommend
  → 工具轮（toolLlm + required，一轮）
  → 答案轮（structuredLlm）
  → 校验重试
模型没有"再查一次"的权利。
```

---

## 6. 本阶段目标架构

```text
recommend
  │
  ├─ Agent Loop（新）：最多 MAX_AGENT_ITERATIONS=5 轮
  │     第 1 轮：llmForceTools（required）→ 强制 grounding
  │     第 2..5 轮：llmWithTools（auto）→ 模型自主决策
  │        有 tool_calls → executeToolCall 逐个执行 → ToolMessage 回写 → 下一轮
  │        无 tool_calls → 自主终止 → 跳出循环
  │     达到 5 轮仍有 tool_calls → throw（兜底，500）
  │
  └─ 答案轮（structuredLlm，JSON mode）+ Phase 01 校验重试（不变）
```

---

## 7. 文件变化

### 新增

```text
travel-recomend-backend/src/__tests__/agentLoop.test.js   # 3 个循环确定性测试
```

### 修改

```text
travel-recomend-backend/src/services/travelService.js
    # runAgentLoop（替代 runToolRound）+ MAX_AGENT_ITERATIONS + 检索预算 SystemMessage
travel-recomend-backend/src/tools/attractions.js
    # 空结果话术：从"请尝试其他关键词"改为"降级用自身知识并标注不确定性"
travel-recomend-backend/src/data/attractions.json
    # 新增三亚 2 条、深圳 1 条景点数据
```

---

## 8. 关键代码

### 8.1 Agent Loop 主体

```js
// src/services/travelService.js（节选）
const MAX_AGENT_ITERATIONS = 5

async runAgentLoop(messages, llmForceTools, llmWithTools) {
    // 第一轮：required 强制 grounding，保证信息收集从工具开始
    let response = await llmForceTools.invoke(messages)
    messages.push(response)
    let iterations = 1
    console.log(`[Agent Loop] 第 1 轮：${response.tool_calls?.length ?? 0} 次工具调用`, ...)

    while (response.tool_calls?.length && iterations < MAX_AGENT_ITERATIONS) {
        // 执行本轮所有工具调用，结果作为 ToolMessage 回写（失败也回写 error）
        for (const toolCall of response.tool_calls) {
            messages.push(await executeToolCall(toolCall))
        }
        // 下一轮：auto 模式，让模型自主决策——继续调工具，或停止
        response = await llmWithTools.invoke(messages)
        messages.push(response)
        iterations++
    }

    // 兜底：达到最大轮数仍在请求工具 → 明确失败，而不是无限烧 token
    if (response.tool_calls?.length) {
        throw new Error(`Agent 达到最大迭代次数（${MAX_AGENT_ITERATIONS} 轮）仍未停止工具调用`)
    }
    return iterations
}
```

**解释**：
1. 循环条件两个：`response.tool_calls?.length`（模型还在请求工具）和 `iterations < MAX_AGENT_ITERATIONS`（还没到上限）
2. 工具执行放在循环体内——每轮的工具结果都成为下一轮决策的输入
3. 兜底 throw 是**设计决策**：宁可明确失败（500 + 清晰 message），不无限烧钱

### 8.2 检索预算（SystemMessage 约束）

```js
new SystemMessage(`你是专业的旅游规划师。规划前必须先调用工具获取真实资料：
- 调用 get_weather 查询目的地天气（1 次即可）
- 调用 search_attractions 检索目的地景点（1-2 次即可，信息足够就停止检索）
...
约束：检索预算有限，不要反复搜索同一目的地；
工具结果不完整时，用你的知识补充并注明不确定性。`)
```

**解释**：模型有"收集癖"（实测见 §12），prompt 层面的预算约束是最便宜的解法——比在代码里数调用次数简单，比 max_iter 更前置。

---

## 9. 完整数据流

```text
User → 路由 → recommend
 ↓
messages = [SystemMessage（角色+工具协议+检索预算）, HumanMessage（需求）]
 ↓
┌─────────────────────────────────────────────┐
│ Agent Loop（最多 5 轮）                       │
│  第 1 轮：llmForceTools(required) → tool_calls │
│  执行工具 → ToolMessage 回写 messages          │
│  第 2+ 轮：llmWithTools(auto)                  │
│     ├─ 有 tool_calls → 执行 → 继续循环          │
│     └─ 无 tool_calls → 自主终止，跳出           │
│  达到 5 轮仍在请求 → throw（500）               │
└─────────────────────────────────────────────┘
 ↓ messages（含全部工具结果）
答案轮：structuredLlm（JSON mode）→ extractJson → zod → 重试 ≤2
 ↓
{success:true, data: 已校验行程} → 前端
```

---

## 10. 运行方式

```bash
cd travel-recomend-backend
npm test       # 23 个测试
npm run dev
```

```bash
curl -X POST http://127.0.0.1:3300/api/travel/recommend \
  -H 'Content-Type: application/json' \
  -d '{"city":"北京","budget":1500,"days":2}'
```

服务端日志里 `[Agent Loop]` 开头的行就是每轮决策实录。

---

## 11. 测试

### 11.1 确定性测试（npm test，23/23）

```text
✔ 多轮循环：模型连续 2 轮请求工具后自主停止
✔ max_iter 兜底：模型无限请求工具 → 抛明确错误而不是无限烧 token
✔ 工具执行失败后循环继续：模型下一轮换参数重试
（连同 Phase 00/01/02 的 20 个，共 23 个，全部通过）
```

### 11.2 真实调用实录（服务端日志）

北京 2 天（3 轮，自主终止）：

```text
[Agent Loop] 第 1 轮：2 次工具调用 get_weather, search_attractions
[Agent Loop] 工具 get_weather({"city":"北京"}) 执行结果： {"city":"北京","condition":"晴","temperature":28}
[Agent Loop] 工具 search_attractions({"query":"北京"}) 执行结果： 故宫博物院/天安门广场/…
[Agent Loop] 第 2 轮：1 次工具调用 search_attractions
[Agent Loop] 第 3 轮：0 次工具调用 （模型停止请求工具）
[Agent Loop] 结束：共 3 轮
→ HTTP 200，行程首站天安门广场（免费）——数据来自工具
```

三亚 2 天（4 轮，检索预算约束生效后）：

```text
[Agent Loop] 第 1 轮：2 次工具调用（天气 + 景点）
[Agent Loop] 第 2 轮：1 次工具调用 search_attractions
[Agent Loop] 第 3 轮：2 次工具调用 search_attractions ×2
[Agent Loop] 第 4 轮：0 次工具调用 （模型停止请求工具）
→ HTTP 200
```

### 11.3 max_iter 兜底实录（三亚，修复前）

```text
模型连续搜索"海南 三亚 / 三亚 海滩 / 天涯海角 / 南山 / 亚龙湾 / 蜈支洲岛 / 鹿回头"……
每次结果都是空，但工具话术在鼓励它"尝试其他关键词"
[Agent Loop] 第 5 轮：1 次工具调用 search_attractions
→ HTTP 500 {"message":"Agent 达到最大迭代次数（5 轮）仍未停止工具调用"}
→ 耗时 24.4s，干净失败——没有无限烧 token
```

---

## 12. 调试指南（本阶段真实踩坑）

### 踩坑 1：模型陷入"无限搜索"，max_iter 兜底救场（教科书级现场）

现象：三亚请求中，模型连续 5 轮换关键词搜索景点（海南 三亚 → 海滩 → 天涯海角 → 南山 → 亚龙湾 → 蜈支洲岛 → 鹿回头），全部空结果却不停手，直到 max_iter 触发。
根因分析：知识库里没有三亚数据 + 工具空结果话术写着"请尝试其他关键词"——**工具话术在鼓励模型继续搜**。
修法（两层）：
1. 治标：补三亚景点数据（数据缺失是真实问题）
2. 治本：改空结果话术为"不要反复更换关键词重试，直接基于自身知识规划并标注不确定性"——让模型学会**优雅降级**
收获：Agent 的失控行为往往不是"模型坏了"，而是**环境给了错误信号**（工具返回、prompt 措辞）。调试 Agent 先查环境信号，再怪模型。

### 踩坑 2：模型有"收集癖"——信息足够仍反复搜索

现象：三亚数据补齐后，模型仍搜了 8 次（美食、夜市、免税店……）才在 5 轮上限前勉强停下。
根因：auto 模式下模型倾向"再查一次更保险"，每轮 3 个并行搜索成本翻倍。
修法：SystemMessage 加**检索预算**（"天气 1 次、景点 1-2 次即可"），三亚从 11 次搜索降到 5 次，北京稳定 3 轮结束。
收获：prompt 层约束是控制 Agent 成本的第一道闸门，比调 max_iter 更前置、比代码计数更简单。

### 踩坑 3：测试要模拟"决策序列"，而不是只测工具

现象：Agent Loop 的测试难点在于模型决策是逐轮的，真实 API 不可控。
修法：stub LLM 按"调用次数"返回预设决策序列（第 1 次返回 tool_call、第 2 次返回 tool_call、第 3 次返回停止），循环逻辑就被完全确定化，三个测试分别覆盖：正常多轮终止、max_iter 兜底、失败后换参数重试。
收获：**给 Agent 写测试的本质是"固定决策序列"**——这条经验 Phase 08（Eval）会继续用。

---

## 13. 常见错误

- 只有 max_iter 一个终止条件——模型自主停止才是正常出口，max_iter 只是保险丝
- 工具失败时抛出异常打断循环——失败应该变成 ToolMessage 数据，让模型在下一轮自己处理
- 所有轮次都用 required——模型永远无法"说停"，只能靠 max_iter 硬切
- 循环里不清点 token 成本——每轮都是全量 messages 重发，轮次越多越贵（Phase 08 优化）

---

## 14. 和上一阶段的关系

Phase 02 的"工具轮 + 答案轮"直线结构，在本阶段被**同一个循环**取代：工具轮只是循环的第一轮，答案轮在循环结束之后。Phase 01 的校验重试、Phase 02 的工具失败降级，全部原样保留在循环内部——**每个 Phase 的产物都成为下一 Phase 的组件**，这是这个项目最重要的架构红利。

下一阶段（Phase 04 — State / Memory）：messages 目前只活在单次请求里，服务重启即失。Phase 04 会引入跨请求的状态（多轮对话、行程草稿保存），并区分 State（单任务内）与 Memory（跨会话）。

---

## 15. 面试问题（附参考回答）

### 基础

**Q1：什么是 Agent？LLM Application 和 Agent 有什么区别？**

参考回答：LLM Application 是"一问一答"：输入 → LLM → 输出，LLM 只负责生成。Agent 在此基础上多了**循环决策**：LLM 可以反复发起工具调用、观察结果、调整策略，直到任务完成。我的项目在 Phase 02 还是直线流程（一轮工具 + 一轮答案），Phase 03 手写了 Agent Loop 之后才真正成为 Agent——这个演进过程本身就是最好的解释素材。

**Q2：Agent Loop 的终止条件有哪些？你的项目怎么设计的？**

参考回答：两个条件互为保险：① 模型返回不含 tool_calls 的回复（自主终止，正常出口）；② max_iterations=5（兜底终止，安全阀）。设计理由：只有 max_iter 的话，模型永远被硬切；只有自主终止的话，模型陷入死循环就无限烧 token。我实测过模型对空结果连续换关键词搜索不停手，正是 max_iter 兜底让它 24 秒干净失败。

**Q3：模型无限调用工具怎么办？你有哪些防护？**

参考回答：四层防护：① prompt 检索预算（"天气 1 次、景点 1-2 次"，实测把三亚的 11 次搜索降到 5 次）；② max_iter 硬兜底（达到上限抛明确错误返回 500）；③ 工具话术引导（空结果时告诉模型"降级用自身知识并标注不确定性"，而不是"请尝试其他关键词"——后者实测会诱发无限重试）；④ 白名单工具集（Phase 02 已有）。四层从软到硬，成本从低到高。

### 项目实践

**Q1：为什么第一轮 tool_choice 用 required，后续轮次用 auto？**

参考回答：required 保证 grounding——Phase 02 实测过 auto 模式下模型会跳过工具直接用参数记忆作答。但如果所有轮次都 required，模型就永远无法"说停"，只能靠 max_iter 硬切，循环就失去了"自主终止"这个正常出口。所以第一轮强制、后续放权：把"继续还是停止"的决策权还给模型。

**Q2：你的循环里工具执行失败是怎么处理的？**

参考回答：不抛异常、不打断循环——失败和空结果都作为带 error 字段的 ToolMessage 回写，模型在下一轮自己决定怎么应对（换参数重试、换工具、或降级作答）。我有测试专门覆盖这个场景：第一轮查未知城市失败，第二轮模型换城市重试成功。理由：模型比 try-catch 更擅长根据错误调整策略，异常流变成数据流是 Agent 设计的关键。

**Q3：循环的 token 成本怎么控制？**

参考回答：目前三层：检索预算 prompt 约束（减少轮次）、max_iter 上限（封顶轮数）、maxTokens 单轮封顶。另外每轮 messages 全量重发是固有成本，Phase 08 会做消息裁剪/摘要。面试官追问成本时可以说：实测三亚请求在预算约束前后从 11 次 LLM 调用降到 5 次，这就是可量化的优化效果。

### 深挖

**Q1：你为什么不直接用 LangChain 的 AgentExecutor，要手写循环？**

参考回答：学习目的决定实现方式。手写一遍才能理解循环的每个环节——终止条件怎么判断、工具结果怎么回写、错误怎么流转；框架把这些都藏起来了，出问题时不知道看哪。而且手写循环可以精确控制每一轮的行为（required/auto 分层这种细节框架不一定让做）。Phase 07 我会用 LangGraph 重写这个循环，届时就能说清框架替我做了什么、代价是什么——而不是"用了但我不知道为什么"。

**Q2：Agent 在多轮之后上下文越来越长，怎么处理？**

参考回答：几个手段：① 工具返回在工具侧就截断（我的 search_attractions 只返回 top 5）；② prompt 约束减少无谓轮次；③ 更长的历史用摘要压缩或滑窗裁剪，只保留最近 N 轮 + 任务目标；④ 结构化地只存"结论"而非原始文本（把工具结果提炼成状态字段）。这些在 Phase 04（State）和 Phase 08 会落地。

**Q3：如何评估 Agent 这个循环是否真的比"直线流程"更好？**

参考回答：要有对照实验。可以量化的指标：成功率（同样 20 个请求，循环版 vs 直线版）、平均轮次/LLM 调用次数（成本）、工具调用失败后的恢复率、以及行程质量（LLM-as-judge 打分）。我的项目 Phase 08 会建 eval 集做这件事。关键是"好"要有数字支撑，不能只凭感觉。

---

## 16. 毕业检查

### 代码

- [x] 手写 Agent Loop（runAgentLoop，非框架封装）
- [x] 双终止条件：模型自主停止 + max_iter=5 兜底
- [x] 第一轮 required / 后续 auto 分层
- [x] 工具失败在循环内恢复（测试覆盖）
- [x] 检索预算约束（实测降低 55% 搜索次数）
- [x] 3 个循环测试，全量 23/23
- [x] 真实调用：北京 3 轮 / 三亚 4 轮自主终止；max_iter 兜底实录
- [x] 没有实现下一阶段内容（无跨请求状态持久化）

### 理解

- [ ] 我能口述 Agent Loop 的循环机制与两个终止条件
- [ ] 我能解释为什么第一轮 required、后续 auto
- [ ] 我能解释 max_iter 兜底的价值（有真实案例）
- [ ] 我能解释"工具话术诱发无限重试"这个案例
- [ ] 我能回答"面试问题"章节的全部问题

### 用户确认

```text
User Confirmation: PENDING
```

---

## 17. 本阶段总结

### 我学会了

- Agent Loop 的完整机制：Observe → Think → Act 循环
- 双终止条件设计与 max_iter 的真实价值（有实录）
- 检索预算等 prompt 层成本控制
- "环境信号诱发 Agent 失控"的调试方法论
- 用 stub 固定决策序列测试 Agent 循环

### 我还不会

- 跨请求的状态保存与恢复（Phase 04）
- 长上下文的压缩与状态结构化（Phase 04/08）

### 下一阶段

```text
Phase 04 — State / Memory
```
