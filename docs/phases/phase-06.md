# Phase 06 — Planning / Reflection

## 1. 本阶段目标

本阶段结束后，我能够：

> 让 Agent 先规划再执行（plan-then-execute），并在生成后用规则校验器检查预算一致性，失败时反馈修正一次（re-plan）。能讲清校验的三层模型和 Reflection 与普通重试的区别。

---

## 2. 为什么学习这个？

### 上一阶段遗留的问题

到 Phase 05 为止，Agent 已经能收集真实资料并生成**格式合法**的行程（Phase 01 的 zod）。但有一个真实缺陷：**内容对不对没人管**。模型说"总预算 1500 元"，用户预算只有 800——系统照单全收。格式校验只保证"能被解析"，不保证"数字靠谱"。

### 新技术解决什么问题？

| 能力 | 说明 |
|---|---|
| Planning | 先出大纲（每天主题+景点+总预算），再展开细节——把"骨架"定下来，展开时不容易跑偏 |
| 校验器 | 规则校验预算一致性：不超用户预算（容差 10%）、明细求和与总预算一致、天数匹配 |
| Reflection | 校验失败 → 把错误反馈给模型 → 重新生成一次（re-plan）——生成 → 批判 → 修正的闭环 |

### 如果不用它？

"总预算 5000 元游 3 天"这种错误会直接呈现给用户。面试官问"模型输出的预算和用户输入不一致怎么办"时没有代码支撑——这恰恰是我 Phase 06 之前项目的真实缺口，现在它成了本阶段的卖点。

---

## 3. 核心概念

**校验的三层模型**（本阶段最重要的概念图，面试直接套用）：

| 层 | 机制 | 检查什么 | 谁来做 |
|---|---|---|---|
| 格式层 | zod schema（Phase 01） | 字段类型对不对（"天数必须是数字"） | 代码，确定性 |
| 语义层 | 规则校验器（本阶段） | 数字合不合理（"预算不能超 10%"） | 代码，确定性 |
| 现实层 | LLM-as-judge（Phase 08 会做） | 内容真不真实（"150 元游北京 2 天真的可行吗"） | 模型，概率性 |

**Plan-then-execute**：把"生成完整行程"拆成"先大纲、后展开"两步。好处：① 总预算在大纲阶段就锁定，展开阶段有约束可循；② 大纲短，格式失败成本低；③ 为 Phase 07 的图结构提供天然的两个节点。

**Reflection vs 重试**：Phase 01 的重试反馈的是"格式错误"（字段名/类型）；Reflection 反馈的是"内容错误"（预算超了 37%）。两者机制相同（错误反馈 → 重新生成），但批判的对象不同——一个看形式，一个看实质。

**克制边界**：re-plan 只做一次。学术上的 Reflexion 会迭代多轮 + 记忆反思，对旅游规划任务收益递减、成本递增。一次修正是"保险丝"，不是"迭代优化"。

---

## 4. 本阶段不学习什么

- 不学多轮迭代反思（Reflexion 论文那一套）——一次 re-plan 足够
- 不学 LLM-as-judge——那是现实层校验，留给 Phase 08 的 eval 体系
- 不学任务分解树/多步骤规划框架——两个工具的 Agent 用不上
- 不学 ReAct 论文细节——概念知道即可，我们的 loop 本质就是简化版 ReAct

---

## 5. 当前代码状态（Phase 05 结束时）

```text
recommend：Loop（收集资料）→ 生成完整行程 → zod 格式校验 → 返回
没有规划步骤；没有语义校验；预算随便写。
```

---

## 6. 本阶段目标架构

```text
recommend
  ├─ Agent Loop（不变，Phase 03）
  │
  └─ 答案阶段（新，plan-then-execute + Reflection）
       ① Planner：基于工具资料生成行程大纲（JSON mode，schema 校验）
          失败 → 反馈重试 1 次 → 仍失败 → 降级跳过规划（不阻塞）
       ② Executor：按大纲展开完整行程 → Phase 01 格式校验 + 重试
       ③ Validator：规则校验（预算/天数/明细/空天）
          通过 → 返回
          失败 → ④ Reflection：错误反馈 → re-plan 一次
                 再校验：通过 → 返回（日志标注修复成功）
                        仍失败 → 500（明确报出全部错误）
```

---

## 7. 文件变化

### 新增

```text
travel-recomend-backend/src/services/planValidator.js        # 语义校验器（5 条规则）
travel-recomend-backend/src/__tests__/planValidator.test.js  # 9 个规则测试
travel-recomend-backend/src/__tests__/reflection.test.js     # 3 个流程测试（stub）
```

### 修改

```text
travel-recomend-backend/src/services/travelService.js
    # generatePlanWithReflection（Planner→Executor→Validator→Re-plan）
    # generateOutline（带降级）
travel-recomend-backend/src/services/travelPlanSchema.js
    # 新增 PlanOutlineSchema
travel-recomend-backend/src/__tests__/agentLoop.test.js
    # stub 适配"大纲"调用
```

---

## 8. 关键代码

### 8.1 语义校验器（规则全表）

```js
// src/services/planValidator.js（节选）
export const BUDGET_TOLERANCE = 0.1

export function validatePlan(userConstraints, plan) {
    const errors = []
    // 1. 天数一致
    if (plan.days !== userConstraints.days) errors.push(`行程天数...与用户要求...不一致`)
    // 2. 总预算不超用户预算（容差 10%）
    if (plan.totalBudget > userConstraints.budget * 1.1) errors.push(`总预算...超出用户预算...`)
    // 3. 明细求和与总预算一致（偏差 ≤10%）
    // 4. 行程条目数与天数一致
    // 5. 每天至少有一个时段有安排
    return { valid: errors.length === 0, errors }
}
```

**解释**：五条规则全部是"确定性可计算"的。错误信息写成**给模型看的中文句子**——它们会原样进入 re-plan 的反馈 prompt，模型读到"总预算 1500 元超出用户预算 800 元（容差 10%）"就知道该改什么。

### 8.2 Reflection 循环

```js
// src/services/travelService.js（节选）
const result = validatePlan(constraints, plan)
if (result.valid) { console.log('[Validator] 行程校验通过'); return plan }

console.error('[Validator] 行程校验失败：', result.errors.join('；'))
console.log('[Reflection] 触发 re-plan（1/1）')
messages.push(new HumanMessage(
    `你生成的行程存在以下问题：${result.errors.join('；')}。请修正这些问题后重新输出完整的行程 JSON...`
))
messages.push(await this.structuredLlm.invoke(messages))
const replanned = await this.validatePlanWithRetries(messages)
const result2 = validatePlan(constraints, replanned)
if (result2.valid) { console.log('[Reflection] re-plan 修复成功'); return replanned }
throw new Error(`行程校验失败（re-plan 后仍不通过）：${result2.errors.join('；')}`)
```

**解释**：Reflection = "校验 → 反馈 → 重新生成"的最小闭环。与 Phase 01 重试的关键区别：反馈内容从"字段类型错误"升级为"业务规则错误"。

### 8.3 大纲降级

```js
async generateOutline(messages) {
    for (let attempt = 0; attempt <= 1; attempt++) {
        try { ...解析 + PlanOutlineSchema.parse → return response }
        catch (error) { ...反馈重试 }
    }
    console.warn('[Planner] 大纲连续失败，跳过规划步骤直接生成完整行程（降级）')
    return null   // 大纲是增强不是依赖——失败不阻塞主流程
}
```

**解释**：规划步骤设计为**可降级**：大纲失败时直接进入展开阶段。这是 Agent 系统的重要原则——增强环节不能成为单点故障。

---

## 9. 完整数据流

```text
User → recommend(city, budget, days)
  ▼
Agent Loop（Phase 03，不变）→ messages 含工具结果
  ▼
① Planner：大纲 {city, days, totalBudget, dailyOutline[]}
     格式失败 → 重试1次 → 仍失败 → 降级跳过
  ▼
② Executor：完整行程 JSON → zod 格式校验 + 带反馈重试 ≤2
  ▼
③ Validator：5 条规则校验
     通过 → 返回行程
  ▼ 失败
④ Reflection：错误清单反馈 → 重新生成一次 → 再校验
     通过 → 返回（re-plan 修复成功）
     失败 → 500（全部错误列出）
```

---

## 10. 运行方式

```bash
cd travel-recomend-backend
npm test       # 48 个测试
npm run dev
```

日志关键行：`[Planner]` / `[Validator]` / `[Reflection]`。

---

## 11. 测试

### 11.1 确定性测试（npm test，48/48）

```text
planValidator（9 个）：
✔ 合法行程通过校验
✔ 总预算超出容差时校验失败
✔ 总预算在容差内（+10%）可以通过
✔ 预算明细求和与总预算偏差过大时校验失败
✔ 缺少预算明细时校验失败
✔ 行程天数与用户要求不一致时校验失败
✔ 行程条目数与天数不一致时校验失败
✔ 某天没有任何行程安排时校验失败
✔ 多个问题同时存在时全部报出

reflection（3 个，stub 固定决策序列）：
✔ 校验失败 → re-plan 一次 → 修复成功
✔ re-plan 后仍不通过 → 抛明确错误（不无限重试）
✔ 大纲生成失败 → 降级跳过规划，直接生成行程
（连同 Phase 00-05 的 36 个，共 48 个，全部通过）
```

### 11.2 真实调用实录（三个有故事的案例）

```text
① 成都 2 天 1200 元（正常路径）：
   [Planner] 行程大纲生成成功：2 天
   [Validator] 行程校验通过
   → HTTP 200

② 北京 2 天 150 元（极紧预算——规则校验的边界）：
   模型返回 totalBudget=150，明细 {住宿0, 餐饮20, 交通40, 门票90, 其他0}，合计恰好 150
   [Validator] 行程校验通过 → HTTP 200
   但"住宿 0 元"显然不现实——这暴露了规则校验的边界：
   它验证"内部一致性"（账算得对），不验证"现实合理性"（150 元游北京是否可行）。
   这正是"现实层"校验（LLM-as-judge）存在的理由，Phase 08 会做。

③ 三亚 5 天 500 元（硬约束下的跨阶段协作）：
   模型反复搜索"免费景点"（5 轮 6 次搜索，知识库只有 2 个三亚景点）
   [Agent Loop] 第 5 轮：1 次工具调用 → Phase 03 的 max_iter 兜底触发
   → HTTP 500 {"message":"Agent 达到最大迭代次数（5 轮）仍未停止工具调用"}，34 秒干净失败
   启示：不同 Phase 的防护是分层协作的——Loop 兜底先于 Validator 生效。
```

### 11.3 关于 re-plan 的诚实说明

re-plan 路径在真实调用中未自然触发（planner 锁定预算后，模型内部一致性很高），由 stub 测试确定性覆盖。**re-plan 是保险丝，不是常态**——这本身就是设计目标：规划做得好，校验就应该少触发。

---

## 12. 调试指南（本阶段真实踩坑）

### 踩坑 1：规则校验通过了，但行程不现实（150 元案例）

现象：北京 2 天 150 元，模型交出了"住宿 0 元"的内部一致行程，校验器放行。
根因：规则校验只能验证**可计算的一致性**（账对不对），无法验证**合理性**（现实可不可行）。
修法：不修——这是校验分层模型的边界，文档里写清楚：现实层校验（LLM-as-judge）是 Phase 08 的内容。面试官问"150 元案例怎么办"时，标准回答：规则层已尽责，现实层需要模型判断，我的路线图里它属于 eval 体系。
收获：**知道校验器的边界，比无限加规则更专业**。规则加到一定程度收益归零（你能写"住宿不能为 0"吗？穷游睡机场呢？）。

### 踩坑 2：硬约束下 Loop 兜底先于 Validator 生效（三亚案例）

现象：三亚 5 天 500 元请求在 Loop 阶段就失败（max_iter），根本没走到 Planner/Validator。
根因：知识库只有 2 个三亚景点，模型想找更多"免费选项"，陷入搜索循环——Phase 03 的"收集癖"在硬约束下复发。
收获：Agent 系统的防护是**分层协作**的：Loop 兜底管"停不下来"，Validator 管"答案不对"，两者覆盖不同的失败模式。排查 Agent 失败时，先看日志定位失败在哪一层，再对症下药。

### 踩坑 3：stub 测试需要适配新增的"大纲"调用

现象：Phase 06 加了大纲步骤后，旧的 agentLoop 测试全挂——它们的 stub 对每个答案阶段调用都返回完整行程，大纲 schema 校验不过。
修法：stub 按 prompt 内容分流：含"大纲"的调用返回大纲 JSON，否则返回完整行程。
收获：答案阶段每加一步，所有依赖它的 stub 都要同步演进。测试的维护成本是真实成本，Phase 08 的 eval 设计要考虑到这点。

---

## 13. 常见错误

- 把 Planning 做成不可降级的硬步骤——大纲失败应降级而不是 500
- Reflection 无限迭代——re-plan 有次数上限，超限明确失败
- 规则校验和格式校验混在一层——格式层管类型，语义层管数值，错误信息才能对症
- 校验规则越加越多——收益递减，现实层交给 LLM-as-judge
- 校验失败静默吞掉——必须 500 并带全部错误信息，否则用户拿到的是坏数据

---

## 14. 和上一阶段的关系

Phase 05 让 Agent "找得准"（资料真实），Phase 06 让 Agent "做得对"（产出可信）——检索管输入，校验管输出。至此，Agent 的"输入可靠 → 决策循环 → 输出可信"闭环完整了。

下一阶段（Phase 07 — LangGraph）：目前整个流程是**手写的过程式代码**（runAgentLoop → generatePlanWithReflection）。Phase 07 用 LangGraph 把它重写成图结构（节点 + 条件边 + 状态），毕业标准是能回答"框架替我做了什么、代价是什么"。

---

## 15. 面试问题（附参考回答）

### 基础

**Q1：什么是 Planning？你的项目里 plan-then-execute 怎么实现的？**

参考回答：Planning 是让 Agent 在动手前先定"怎么做"。我的实现是两段式：Agent Loop 收集完资料后，先用一次 LLM 调用生成**行程大纲**（每天主题、景点、总预算），校验通过后再展开为完整行程。好处：总预算在大纲阶段锁定，展开阶段有约束可循；大纲短，失败重试成本低。另外我的规划步骤是**可降级**的——大纲连续失败就跳过直接展开，增强环节不能成为单点故障。

**Q2：Reflection 是什么？和你之前的重试机制有什么区别？**

参考回答：Reflection 是"生成 → 批判 → 修正"的闭环。我在 Phase 01 就有重试，但那是**格式层**——zod 校验失败后把字段错误反馈给模型；本阶段的 Reflection 是**语义层**——规则校验器发现"总预算超出用户预算 37%"后，把这个业务错误反馈给模型重新生成。机制相同（错误反馈 → 重新生成），批判的对象不同：一个看形式，一个看实质。

**Q3：你的校验有哪几层？各管什么？**

参考回答：三层。格式层：zod schema，管字段类型（天数是数字）；语义层：规则校验器，管数值合理性（预算不超 10%、明细求和一致）；现实层：LLM-as-judge，管内容真实性（150 元游北京是否现实）——第三层我还没做，属于 Phase 08 的 eval 体系。这个分层模型是我面试时最想讲的：**知道每层校验的边界，比无限加规则专业**。

### 项目实践

**Q1：你的预算校验规则怎么设计？容差为什么 10%？**

参考回答：五条规则：天数一致、总预算不超用户预算（容差 10%）、明细求和与总预算一致（偏差 ≤10%）、行程条目数与天数一致、每天至少一个时段有安排。10% 容差的原因：行程报价本身有弹性，严格"不多一分钱"会导致大量无谓 re-plan。容差是产品决策，不是技术常数——收紧会更严格，但会牺牲成功率。

**Q2：re-plan 为什么只做一次？**

参考回答：成本与收益的权衡：re-plan 一次能修好大多数"算错账"的问题；连续失败说明问题不是"粗心"而是"约束不可满足"（比如 5 天 500 元游三亚），再迭代只是烧 token。所以我的设计：一次修正是保险丝，超限明确 500 并带全部错误信息。学术上的 Reflexion 会多轮迭代 + 记忆反思，对旅游规划任务收益递减。

**Q3：150 元游北京的行程通过了你的校验，但住宿费是 0——你怎么看？**

参考回答：这说明规则校验在工作：模型学会了内部一致（明细合计恰好等于总预算）。但也暴露了规则校验的边界——它验证"账算得对"，不验证"现实可行"。住宿 0 元是否合理，规则写不出来（穷游睡机场也算一种答案）。这正是现实层校验（LLM-as-judge）存在的理由：让模型当裁判，判断"这个行程给真人推荐是否靠谱"。

### 深挖

**Q1：规则校验和 LLM-as-judge 各有什么优劣？**

参考回答：规则校验：确定性、零成本、可复现，但只能检查"可计算"的属性，边界明显；LLM-as-judge：能判断语义合理性，但概率性、有成本、需要校准（rubric + 锚点）。生产实践是两者配合：规则打底（便宜、必过），LLM-judge 抽检或兜底（贵、挑重要的查）。这也是我 Phase 08 eval 的设计思路。

**Q2：自我反思的局限是什么？**

参考回答：模型很难发现自己的错误——它生成时"认为自己是对的"，反思时带着同样的偏见。所以我的 Reflection 不是让模型"自省"，而是**外部规则校验器**指出具体错误（"超预算 37%"），模型只负责"按指出的错误修正"。外部信号 > 自我批判，这是工程上更可靠的反思形态。

**Q3：plan-then-execute 多了一次大纲调用，成本怎么算？**

参考回答：大纲调用约 500 token，占整个流程（工具循环 3-4 轮 + 完整行程）的 10% 左右。收益：总预算提前锁定（减少 re-plan 概率）、失败成本低（大纲错了重来比完整行程错了重来便宜）。如果成本敏感，可以把大纲和第一轮工具调用合并（让模型在 tool_calls 的同时输出 plan）——但那是优化，不是正确性。

---

## 16. 毕业检查

### 代码

- [x] plan-then-execute 两段式（Planner → Executor）
- [x] 5 条规则的语义校验器（预算/天数/明细/空天）
- [x] Reflection：校验失败 → 反馈 → re-plan 一次 → 仍失败 500
- [x] 大纲降级（连续失败跳过规划）
- [x] 12 个新测试，全量 48/48
- [x] 真实调用：正常通过 + 150 元边界案例 + 三亚分层防护案例（全部实录）
- [x] 没有实现下一阶段内容（无 LangGraph、无 LLM-as-judge）

### 理解

- [ ] 我能画出校验三层模型（格式/语义/现实）并各举一例
- [ ] 我能解释 Reflection 与 Phase 01 重试的本质区别
- [ ] 我能解释 re-plan 只做一次的成本逻辑
- [ ] 我能用 150 元案例讲清规则校验的边界
- [ ] 我能回答"面试问题"章节的全部问题

### 用户确认

```text
User Confirmation: PENDING
```

---

## 17. 本阶段总结

### 我学会了

- plan-then-execute 的两段式设计与降级策略
- 语义校验器的规则设计（容差是产品决策）
- Reflection 最小闭环：外部校验信号 → 定向修正
- 校验三层模型的边界意识
- Agent 防护的分层协作（Loop 兜底 vs Validator）

### 我还不会

- 图结构的 Agent 工作流（Phase 07）
- LLM-as-judge 的 eval 体系（Phase 08）

### 下一阶段

```text
Phase 07 — LangGraph
```
