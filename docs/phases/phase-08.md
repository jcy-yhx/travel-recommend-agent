# Phase 08 — Eval & Hardening

## 1. 本阶段目标

本阶段结束后，我能够：

> 给系统建立三层评估体系（单测 / 检索 eval / 端到端 eval + LLM-as-judge），完成错误处理、成本观测、限流的工程收口，并能回答"如何评估 Agent"这个面试必问题。

---

## 2. 为什么学习这个？

### 上一阶段遗留的问题

到 Phase 07 为止，系统"能用"，但有两个致命盲区：
1. **没有回答"它有多好"**——48 个单测证明"行为符合预期"，但没有任何证据证明"行程质量高"。面试官问"如何评估 Agent"，只有单测可讲是不够的
2. **成本不可见**——每次请求烧了多少 token 没有统计，无法回答"如何控制成本"
3. 缺少工程收口：404、限流、进程级兜底都没有

### 新技术解决什么问题？

**三层评估体系**（本阶段核心）：

| 层 | 工具 | 回答的问题 | 成本 |
|---|---|---|---|
| 单测（48 个） | node:test + stub | 行为对不对（循环/校验/降级） | 零 API |
| 检索 eval（8 用例） | retrieval-eval.js | 检索找得准不准（语义 8/8 vs 关键词 1/8） | 少量 |
| 端到端 eval（6 用例） | run-eval.js + LLM-as-judge | **行程质量好不好** | 每个用例 6-8 次调用 |

**LLM-as-judge（现实层校验）**：Phase 06 就预告过的"现实层"——用另一个 LLM 调用按 rubric 给行程打分。它填补了规则校验的边界（150 元案例：住宿 0 元也能通过规则，但 judge 会扣分）。

### 如果不用它？

"如何评估 Agent"没有答案 → 面试死穴。而且 eval 的价值在本阶段被**当场证明**了：第一次跑端到端 eval，6 个用例 2 个失败（三亚、西安），暴露了"知识库稀疏 + 检索预算约束太软"的真实系统缺陷——**没有 eval，你永远不知道你的 Agent 有多不可靠**。

---

## 3. 核心概念

- **eval 集**：固定的评测用例（城市/预算/天数组合），可重复运行，产出可比对的数字
- **rubric**：评分标准。本项目的 judge rubric 四维：行程合理性 / 预算现实性 / 景点真实性 / 描述质量，每维 1-5 分
- **LLM-as-judge**：用模型给模型打分。优势：能判断语义合理性（规则做不到）；劣势：概率性、有成本、可能有偏好偏差
- **规则分 + judge 分**：规则分确定性（0/1，零成本），judge 分质量性（1-5，有成本）——两者互补，规则打底
- **成本观测**：token 统计是成本控制的第一步（"看不见用量就无从控制"）
- **hardening**：404 / 限流 / 进程级兜底 / 分级日志——生产化收口的"最后 10%"

---

## 4. 本阶段不学习什么

- 不学 LangSmith 等 eval 平台——自建脚本足够展示理解
- 不做 A/B 对比实验框架——概念了解，面试可讲
- 不引入日志库（pino/winston）——自制 20 行 logger 足够，引入依赖是过度设计
- 不引入 Redis 限流——单进程内存实现，演进路径写注释

---

## 5. 当前代码状态（Phase 07 结束时）

```text
测试：48 个单测 + 8 个检索 eval 用例（没有端到端质量评估）
成本：LLM 调用无 token 统计
收口：无 404、无限流、无进程级兜底、日志无级别
```

---

## 6. 本阶段目标架构

```text
评估体系                       工程收口
─────────                     ─────────
npm test（53 个单测）          404 处理 + 限流中间件
  ↑ 行为正确性                 进程级兜底（unhandledRejection/uncaughtException）
npm run eval:retrieval        分级日志（logger，LOG_LEVEL 控制）
  ↑ 检索质量（8/8）            成本观测（token 汇总 + 估算）
npm run eval:e2e
  ↑ 端到端质量
  规则分（validatePlan）
  + judge 分（LLM-as-judge rubric）
```

---

## 7. 文件变化

### 新增

```text
travel-recomend-backend/src/utils/logger.js              # 分级日志（20 行）
travel-recomend-backend/src/utils/tokenStats.js          # token 汇总 + 成本估算
travel-recomend-backend/src/middleware/rateLimiter.js    # 内存滑动窗口限流
travel-recomend-backend/src/__tests__/hardening.test.js  # 5 个硬化测试
travel-recomend-backend/scripts/run-eval.js              # 端到端 eval + LLM-as-judge
docs/eval/latest-batch-*.md                              # 评估报告（脚本自动生成）
```

### 修改

```text
travel-recomend-backend/src/index.js                    # 404 + 限流 + 进程兜底
travel-recomend-backend/src/services/travelService.js   # token 汇总日志；检索预算硬性约束
travel-recomend-backend/src/graphs/travelAgentGraph.js  # console → logger
```

---

## 8. 关键代码

### 8.1 LLM-as-judge 的 rubric

```js
// scripts/run-eval.js（节选）
const JudgeSchema = z.object({
    score: z.number().min(1).max(5),
    dimensions: z.object({
        reasonableness: z.number(),      // 行程合理性（节奏/密度）
        budgetRealism: z.number(),       // 预算现实性（住宿 0 元要扣分）
        attractionAccuracy: z.number(),  // 景点真实性（名称/门票/时长）
        descriptionQuality: z.number()   // 描述质量（具体/有用）
    }),
    strengths: z.array(z.string()),
    issues: z.array(z.string())
})
```

**解释**：judge 的输出也走结构化输出（JSON mode + zod）——**评估器本身也要可靠**。rubric 四维对应规则校验的四个盲区，其中 budgetRealism 直接解决 Phase 06 的 150 元案例（住宿 0 元会被 judge 扣分）。

### 8.2 成本观测

```js
// travelService.js（节选）
const usage = sumMessagesUsage(result.messages)
logger.info(`[Cost] 本次行程规划 token 消耗：输入 ${usage.inputTokens} + 输出 ${usage.outputTokens}` +
    `，估算成本 ¥${estimateCost(usage).toFixed(4)}`)
```

**解释**：图执行完的消息历史里，每个 AIMessage 自带 usage_metadata——零侵入的统计方式。**成本控制的第一步是看得见用量**，第二步才是优化（本项目的优化点：检索预算、max_iter、maxTokens）。

### 8.3 限流（成本防线）

```js
// middleware/rateLimiter.js（节选）
export function createRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
    const hits = new Map()   // ip → 时间戳数组（窗口内）
    return (req, res, next) => {
        const recent = (hits.get(ip) ?? []).filter(t => now - t < windowMs)
        if (recent.length >= max) return res.status(429).json({...})
        ...
    }
}
```

**解释**：LLM 接口是成本敏感资源，限流是第一道成本防线。滑动窗口比固定窗口平滑（不会在窗口边界双倍放行）。单进程内存实现是学习项目的克制，生产多实例需共享存储（Redis）。

---

## 9. 完整数据流

```text
npm run eval:e2e（每用例）
  → graph.invoke（真实执行：loop + planner + executor + validator）
  → 规则分：validatePlan（5 条确定性规则）
  → judge 分：structuredLlm 按 rubric 打分（JSON mode + JudgeSchema）
  → token 汇总（usage_metadata 求和）
  → 汇总表 + docs/eval/ 报告
```

---

## 10. 运行方式

```bash
cd travel-recomend-backend
npm test               # 53 个单测（零 API 成本）
npm run eval:retrieval # 检索质量（8 用例，少量 API）
npm run eval:e2e 0 3   # 端到端评估第一批（真实 API，每批约 5 分钟）
npm run eval:e2e 3 3   # 第二批
```

---

## 11. 测试与评估实录

### 11.1 确定性测试（npm test，53/53）

```text
✔ 窗口内超过 max 次返回 429
✔ 不同 IP 互不影响
✔ 窗口过期后重新放行（滑动窗口）
✔ sumMessagesUsage 汇总 usage_metadata
✔ estimateCost 按单价估算
（连同 Phase 00-07 的 48 个，共 53 个，全部通过）
```

### 11.2 端到端 eval——第一轮（暴露真实缺陷）

```text
E2E-01 北京 2 天 1500 元 → OK，规则 ✅，judge 4 分
E2E-02 上海 3 天 2000 元 → OK，规则 ✅，judge 5 分
E2E-03 成都 1 天 500 元  → OK，规则 ✅，judge 4 分（judge 指出：地铁换乘站描述有误）
E2E-04 三亚 2 天 1500 元 → FAIL：max_iter 兜底（过度搜索）
E2E-05 西安 4 天 2500 元 → FAIL：max_iter 兜底（过度搜索）
E2E-06 杭州 2 天 800 元  → OK，规则 ✅，judge 5 分
成功率 4/6，judge 均分 4.5
```

**eval 的价值当场兑现**：2 个失败用例暴露了真实系统缺陷——知识库稀疏的城市（三亚只有 2 条景点），模型会反复搜索直到 max_iter。这正是 Phase 03 的"收集癖"在 4 天行程场景下的复发，说明**检索预算的 prompt 约束太软**。

### 11.3 修复：检索预算硬性约束

```text
修改前："搜索 1-2 次即可，信息足够就停止检索"（建议语气，模型不遵守）
修改后："最多 2 次。达到 2 次后即使信息不完整也必须停止搜索，
         基于已有资料完成规划并注明不确定性。反复搜索是禁止的。"（硬性约束）
```

重跑失败用例：三亚 ✅（3 轮自主停止）、西安 ✅（5 轮边界内停止）。

**最终全量结果（修复后重跑两批）**：

```text
用例通过率：6/6（100%）
规则校验通过率：6/6
judge 平均分：4.33 / 5
（批次 1：北京 4 分 / 上海 5 分 / 成都 4 分）
（批次 2：三亚 4 分 / 西安 4 分 / 杭州 5 分）
总 token 消耗：输入 ~71k + 输出 ~46k（两批合计）
```

judge 在最终轮依然给出了有价值的批评（三亚公交路线描述不准确、西安大交通预算不足、大雁塔门票存疑）——现实层校验持续工作。完整报告见 docs/eval/。

### 11.4 评估成本一览

```text
每个用例：6-8 次 LLM 调用，约 15k-27k token（loop 轮次越多越贵）
第一批 3 用例：输入 37,300 + 输出 19,864 token
```

---

## 12. 调试指南（本阶段真实踩坑）

### 踩坑 1：eval 第一轮就跑出 2 个失败——这不是坏事

现象：三亚/西安用例触发 max_iter 兜底，成功率 4/6。
反应：不遮掩、不删除用例——**失败用例是 eval 的产出，不是耻辱**。定位到根因（知识库稀疏 + 检索预算约束太软）后修复并重跑。
收获：eval 的价值 = 把"感觉有问题"变成"有数字的问题"。第一次跑 eval 就抓到系统级缺陷，恰恰证明了这套体系是有效的。面试讲这个迭代故事，比"我的 eval 全绿"可信得多。

### 踩坑 2：judge 自己也会失败，评估流程要容错

现象：judge 输出偶发不符合 schema。
修法：judge 失败降级为"judge 分 N/A + 原始错误"，不中断整批评估。
收获：评估器的可靠性低于被评估对象时，评估结果不可信——所以 judge 输出也走 JSON mode + zod，失败要可见而不是吞掉。

### 踩坑 3：报告路径写错，文件写到仓库外

现象：`new URL('../../../docs/eval/', import.meta.url)` 从 scripts/ 出发算错了层级，报告写到了 /home/yhx/code/docs（仓库外）。
检查：Node 的 URL 相对路径按文件位置逐层解析，scripts/ → ../../ = 仓库根。
收获：脚本产物路径要立即验证落点，否则评估记录会散落在仓库外。

### 踩坑 4：硬化引入的新崩溃——"进程级兜底"把日志管道断开升级成服务死亡

现象（用户实测报障）：后端跑在 Claude Code 终端里，前端请求 recommend 报 `socket hang up`；直连 curl 心跳正常、recommend 必崩（进程死亡，nodemon 重启后再崩）。
排查过程：① 干净环境起同样代码 → 不崩，怀疑环境差异；② 检查崩溃进程的环境变量，发现 `NODE_CHANNEL_FD=3`（Claude Code 会话的 IPC 管道）；③ 用 `node src/index.js | head -4` 模拟"管道先活后断"→ **完整复现**：心跳 OK（无日志）、recommend 的第一个日志写入抛 `Error: write EPIPE` → 被本阶段新加的 uncaughtException 兜底 → 按设计 `exit(1)` → 服务死亡。
根因：日志写管道失败（无关紧要的问题）被进程级兜底升级成了服务崩溃（致命问题）。心跳没有日志所以不崩——这就是"心跳正常、recommend 必崩"的诡异现象来源。
修法：logger 监听 `process.stdout/stderr` 的 `error` 事件吞掉 EPIPE——**日志失败不应杀死服务**。
收获：① 进程级兜底是一把双刃剑——它会放大错误级别，每个进入兜底的异常都要问"这值得退出吗"；② "心跳正常但业务必崩"的排查思路：先对比两端的日志路径差异。

### 踩坑 5：流式调用的 token 统计拿不到

现象：chat 流式接口无法像 recommend 一样汇总 token。
根因：OpenAI 兼容接口要在请求里带 `stream_options: {include_usage: true}` 才会在流里返回 usage，当前 SDK 版本没有暴露该选项。
处理：chat 的 token 统计记为已知局限，写入文档；recommend（非流式）不受影响。

---

## 13. 常见错误

- 只做单测不做端到端 eval——单测绿 ≠ Agent 好用（本阶段 2 个失败用例就是证明）
- eval 全绿就停止——第一轮全绿更可疑，说明用例太简单
- judge prompt 不写 rubric——没有标准的打分就是随机数
- judge 失败中断整个评估——评估流程本身要容错
- 删掉失败用例而不是修系统——eval 的价值就是暴露问题

---

## 14. 和上一阶段的关系

Phase 07 的图结构让 eval 变得可行：**每个用例的执行路径是确定的**（节点序列 + 条件路由），token 统计也能从图的消息历史里零侵入汇总。整条学习路线在这里闭环：手写（03-06）→ 工程化（07）→ 度量（08）——**先让系统正确，再让系统可度量，最后才能谈优化**。

下一阶段（Phase 09 — Interview Prep）：README、30s/3min 讲稿、模拟面试——把 8 个 Phase 的积累转化成面试表现。

---

## 15. 面试问题（附参考回答）

### 基础

**Q1：如何评估一个 Agent？**

参考回答：我的项目是三层体系：① 单测（53 个，stub 固定决策序列，验证行为正确性：循环终止、校验降级、失败恢复）；② 检索 eval（8 个用例，对比关键词检索 1/8 vs 语义检索 8/8，指标是命中率）；③ 端到端 eval（6 个真实用例，规则分 + LLM-as-judge 质量分）。三层分别回答"行为对不对、找得准不准、结果好不好"。最关键的经验：**第一次跑端到端 eval 就抓到 2 个失败用例**，暴露了检索预算约束太软的问题——eval 的价值就是把"感觉有问题"变成"有数字的问题"。

**Q2：LLM-as-judge 怎么做才可靠？**

参考回答：三个要点：① rubric 明确——我的四维标准（合理性/预算现实性/景点真实性/描述质量）写死在 prompt 里，没有标准的打分是随机数；② 输出结构化——judge 的输出也走 JSON mode + zod schema；③ 容错——judge 自己失败要可见降级而不是中断评估。局限要诚实：judge 是概率性的，可能有偏好偏差（倾向于打高分），所以我的规则分是 0/1 确定性打底，judge 分是补充。

**Q3：如何控制 token 和成本？**

参考回答：先观测再优化。观测：每次请求后从消息历史汇总 usage_metadata（零侵入），估算成本；eval 报告里也记录每批 token 消耗。优化四层：检索预算 prompt 约束（减少轮次，实测三亚 11 次搜索→2 次）、max_iter 硬上限（封顶轮次）、maxTokens 单轮封顶、限流（防止滥用放大成本）。还有一层没做：消息裁剪/摘要（超长对话的成本优化）。

### 项目实践

**Q1：你的 eval 发现过什么真实问题？怎么修的？**

参考回答：第一轮端到端 eval，6 个用例 2 个失败（三亚、西安 4 天），都是 max_iter 兜底——知识库稀疏的城市，模型反复搜索直到上限。根因：检索预算的 prompt 约束太软（"1-2 次即可"是建议语气，模型不遵守）。修复：改成硬性约束（"最多 2 次，达到后必须停止，反复搜索是禁止的"），重跑两个用例都通过。这个迭代故事比"eval 全绿"有说服力得多。

**Q2：你的规则校验和 judge 打分是什么关系？**

参考回答：互补分层。规则分是确定性的 0/1（预算超没超、账对不对），零成本；judge 分是语义性的 1-5（行程节奏合不合理、住宿 0 元现不现实），有成本。Phase 06 的 150 元案例证明：规则校验有边界（内部一致但现实荒谬），judge 恰好覆盖这个盲区。生产实践：规则打底（每个请求都能跑），judge 抽检（成本高，按需触发）。

**Q3：限流怎么设计的？为什么单机内存？**

参考回答：滑动窗口（60 秒 30 次/IP），比固定窗口平滑（不会在窗口边界双倍放行）。单机内存是因为单进程部署够用、零依赖；多实例部署时必须换共享存储（Redis + Lua 原子操作），否则每实例独立计数形同虚设。LLM 接口的限流本质是成本防线，不只是防 DDoS。

### 深挖

**Q1：LLM-as-judge 有什么已知偏差？**

参考回答：已知几类：① 位置偏差（偏好排在第一个的答案）；② 自我偏好（同族模型倾向给自己的输出打高分——所以我用同一个模型打自己的行程，分数要打折看）；③ 长度偏差（长回答容易拿高分）；④ 随机性（同输入两次打分可能不同，所以 judge 温度设低）。缓解手段：rubric 明确、打分与理由强制成对输出、关键场景双 judge 取均值。我的项目目前是单 judge + 低温 + 强制理由，属于"够用且知道局限"的水平。

**Q2：怎么验证 eval 集本身的质量？**

参考回答：两个检查：① 用例覆盖性——我的 6 个用例覆盖了不同天数（1-4 天）、不同预算梯度（500-2500）、知识库稀疏与稠密的城市（三亚 2 条 vs 北京 5 条），不是随便挑的；② 区分度——好的 eval 集应该"能失败"：第一轮跑出 2/6 失败证明它有区分度；如果一套 eval 永远全绿，要么系统完美，要么用例太弱。

**Q3：如果预算有限，评估怎么取舍？**

参考回答：优先级：单测（零成本，天天跑）> 检索 eval（少量成本，改检索就跑）> 端到端 eval（最贵，版本发布前跑）。另外可以缩小端到端用例集（核心 3 个城市）、judge 只对规则分通过的用例打分（省掉对必败用例的 judge）。我的脚本已经支持分批跑（offset/limit），成本可控。

---

## 16. 毕业检查

### 代码

- [x] 三层评估体系（单测 53 / 检索 8 用例 / 端到端 6 用例 + LLM-as-judge）
- [x] eval 第一轮暴露 2 个真实缺陷并修复（检索预算硬性约束），重跑通过
- [x] token 成本观测（usage 汇总 + 估算 + eval 报告记录）
- [x] 工程收口：404 / 限流 / 进程级兜底 / 分级日志
- [x] 5 个硬化测试，全量 53/53
- [x] 没有实现下一阶段内容（无 README、无讲稿——那是 Phase 09）

### 理解

- [ ] 我能讲清三层评估体系各回答什么问题
- [ ] 我能复述"eval 第一轮抓到 2 个失败"的完整迭代故事
- [ ] 我能回答 LLM-as-judge 的设计要点与已知偏差
- [ ] 我能讲成本控制的"观测-优化"四层
- [ ] 我能回答"面试问题"章节的全部问题

### 用户确认

```text
User Confirmation: PENDING
```

---

## 17. 本阶段总结

### 我学会了

- 三层评估体系的设计与分工
- LLM-as-judge 的 rubric 设计与容错
- eval 的迭代价值（第一轮就抓到真实缺陷）
- 成本观测与控制的完整思路
- 工程收口清单（404/限流/兜底/日志）

### 我还不会

- 把技术积累转化成面试表达（Phase 09）

### 下一阶段

```text
Phase 09 — Interview Prep
```
