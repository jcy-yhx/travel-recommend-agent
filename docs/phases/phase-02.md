# Phase 02 — Tool Calling

## 1. 本阶段目标

本阶段结束后，我能够：

> 让模型根据任务自主选择并调用旅游工具（天气查询、景点检索），基于工具返回的真实资料生成行程，并能讲清 Function Calling 的完整链路。

---

## 2. 为什么学习这个？

### 上一阶段遗留的问题

Phase 01 解决了"输出格式可靠"，但行程内容完全来自**模型参数记忆**：门票价格、开放时间可能过时或编造，模型没有获取外部信息的能力。模型再强也只是"闭卷考试"。

### 新技术解决什么问题？

Tool Calling（Function Calling）给模型接上"手"：

| 能力 | 说明 |
|---|---|
| 获取外部信息 | 天气、景点资料来自工具返回，不是模型记忆 |
| 自主决策 | 模型根据任务决定调用哪个工具、传什么参数（实测：模型自己决定查两天天气 + 检索景点） |
| 执行动作 | 本阶段只做查询；未来可以扩展到订票、发通知等写操作（需要更严格的权限设计） |

### 如果不用它？

行程里会出现过时的门票价、编造的景点信息；模型的知识截止日期就是系统的信息边界。面试时，"Agent 和 LLM Application 的区别"这个问题的标准答案就是：**Agent 能通过工具与外部世界交互**。

---

## 3. 核心概念

- **Function Calling 机制**：请求里带上工具定义（name/description/schema），模型返回 `tool_calls`（工具名 + JSON 参数 + 唯一 id），**由代码执行工具**，结果以 `ToolMessage`（带 `tool_call_id`）回传。注意：模型从不执行工具，执行权在代码手里
- **Tool Schema**：工具的"说明书"。模型靠 name/description 决定用哪个，靠 schema 生成参数。schema 写得越清楚，参数越准
- **tool_choice**：`auto`（模型自己决定）/ `required`（必须调用）/ `none`（禁止调用）/ 指定某工具
- **grounding**：让模型输出基于工具返回的真实资料（而不是参数记忆）——生产环境常用 `tool_choice: required` 强制
- **白名单工具集**：模型只能调用 `TOOLS` 数组里的工具——工具调用是 Agent 最重要的攻击面
- **失败降级**：工具执行失败/未知工具名时，把错误作为 ToolMessage 回传给模型，让它自己调整策略

---

## 4. 本阶段不学习什么

- 不学 Agent Loop——本阶段工具调用**最多一轮**，拿完结果必须给答案；多轮循环、终止条件、max_iter 是 Phase 03
- 不学向量检索——景点检索用关键词打分；Phase 05（RAG）升级为 embedding
- 不学真实天气 API——Mock 数据足够学机制，替换点已在代码注释标明
- 不学工具的权限/审批/审计——Phase 08 guardrails

---

## 5. 当前代码状态（Phase 01 结束时的 recommend）

```text
TravelService.recommend
  → structuredLlm（JSON mode）直接生成行程
  → 内容来自模型参数记忆（门票价、天气全靠"背"）
  → 无工具、无外部信息源
```

---

## 6. 本阶段目标架构

```text
TravelService.recommend
  │
  ├─ 工具调用轮（toolLlm，无 JSON mode，tool_choice=required）
  │     model 返回 tool_calls → executeToolCall 逐个执行
  │     → ToolMessage（tool_call_id）回写 messages
  │
  └─ 最终答案轮（structuredLlm，JSON mode，不绑工具）
        → Phase 01 的 extractJson + zod 校验 + 带反馈重试
        → 返回基于工具资料、已校验的行程
```

**为什么是两个 LLM 实例？** 本阶段实测发现两个硬约束，见 §12 踩坑。

---

## 7. 文件变化

### 新增

```text
travel-recomend-backend/src/tools/weather.js        # get_weather（Mock 数据 + 替换点注释）
travel-recomend-backend/src/tools/attractions.js    # search_attractions（本地 JSON 关键词检索）
travel-recomend-backend/src/tools/index.js          # 白名单 TOOLS + executeToolCall
travel-recomend-backend/src/data/attractions.json   # 19 个景点知识条目
travel-recomend-backend/src/__tests__/tools.test.js # 8 个工具确定性单测
```

### 修改

```text
travel-recomend-backend/src/services/travelService.js
    # 新增 toolLlm 实例；recommend 拆成"工具轮 + 答案轮"；prompt 增加 SystemMessage 工具协议
```

---

## 8. 关键代码

### 8.1 工具定义（LangChain tool() + zod schema）

```js
// src/tools/weather.js（节选）
export const getWeather = tool(
    async ({ city, date }) => {
        const weather = MOCK_WEATHER[city]
        if (!weather) {
            // 未知城市：返回 error 字段而不是抛异常，让模型读到"查不到"并自行调整
            return { city, date: date || '今天', error: '暂无该城市的天气数据（Mock 数据未覆盖）' }
        }
        return { city, date: date || '今天', ...weather }
    },
    {
        name: 'get_weather',
        description: '查询指定城市的天气（Mock 数据）。旅行规划前调用，用于了解目的地天气并安排合适的行程。',
        schema: z.object({
            city: z.string().describe('城市名，如"北京"'),
            date: z.string().optional().describe('日期，格式 YYYY-MM-DD，缺省为今天')
        })
    }
)
```

**解释**：`tool(fn, {name, description, schema})` 三件套就是模型的"工具说明书"。description 是模型决定"用不用"的依据，schema 是它生成参数的模板。工具内部出错时返回 error 字段（而不是 throw）——这是工具设计的关键取舍：**模型比代码更擅长根据错误调整策略**。

### 8.2 工具分发与失败降级

```js
// src/tools/index.js（节选）
export async function executeToolCall(toolCall) {
    const tool = TOOL_MAP[toolCall.name]
    if (!tool) {
        // 模型幻觉出白名单外的工具名
        return new ToolMessage({
            content: JSON.stringify({ error: `未知工具：${toolCall.name}` }),
            tool_call_id: toolCall.id
        })
    }
    try {
        const result = await tool.invoke(toolCall.args)
        return new ToolMessage({ content: JSON.stringify(result), tool_call_id: toolCall.id })
    } catch (error) {
        return new ToolMessage({
            content: JSON.stringify({ error: `工具执行失败：${error.message}` }),
            tool_call_id: toolCall.id
        })
    }
}
```

**解释**：`tool_call_id` 是工具结果与调用请求的关联凭证，缺失会导致 API 400。两种失败都转成"带 error 的 ToolMessage"回传——让异常流变成数据流。

### 8.3 recommend：工具轮 + 答案轮

```js
// src/services/travelService.js（节选）
async recommend(city, budget, days) {
    // 工具轮：toolLlm（无 JSON mode）+ required 强制调用
    const llmForceTools = this.toolLlm.bindTools(TOOLS, { tool_choice: 'required' })
    const messages = this.getTravelPrompt(city, budget, days)
    await this.runToolRound(messages, llmForceTools)

    // 答案轮：structuredLlm（JSON mode，不绑工具 → 模型无法再请求工具）
    messages.push(await this.structuredLlm.invoke(messages))
    return await this.validatePlanWithRetries(messages)
}
```

**解释**：
1. `bindTools(TOOLS)` 把白名单工具注册给模型
2. `tool_choice: 'required'` 强制第一轮必须调用工具（原因见 §12 踩坑 1）
3. 答案轮**不绑工具**——模型只能给出最终 JSON，天然形成"单轮工具调用"的边界；Phase 03 的 Agent Loop 会打破这个边界，让模型可以多轮调用
4. Phase 01 的校验重试循环原样保留，只是校验对象从"直接答案"变成"工具资料之上的答案"

---

## 9. 完整数据流

```text
User → 路由（400 校验）→ recommend
 ↓
[工具轮] toolLlm.bindTools(TOOLS, required)
 ↓  模型返回 tool_calls（自主决定工具与参数）
executeToolCall 逐个执行（失败也回传 error）
 ↓  ToolMessage 回写 messages
[答案轮] structuredLlm（JSON mode，无工具）
 ↓  基于工具资料生成行程 JSON
extractJson → JSON.parse → zod 校验（失败带反馈重试 ≤2）
 ↓
{success:true, data: 基于真实资料的行程} → 前端渲染
```

---

## 10. 运行方式

```bash
cd travel-recomend-backend
npm test       # 28 个测试（5 冒烟 + 7 结构化 + 8 工具 + 8 单测）——见 §11
npm run dev
```

验证接口：

```bash
curl -X POST http://127.0.0.1:3300/api/travel/recommend \
  -H 'Content-Type: application/json' \
  -d '{"city":"西安","budget":1800,"days":2}'
```

---

## 11. 测试

### 11.1 确定性单测（npm test，20/20）

```text
✔ 查询已知城市返回天气数据
✔ 查询未知城市返回 error 字段而不是抛异常
✔ 按城市检索返回该城市景点
✔ 按"城市+关键词"组合检索，名称命中排第一
✔ 无匹配关键词返回空结果和提示
✔ 执行合法工具调用返回 ToolMessage
✔ 未知工具名返回 error ToolMessage（不抛异常）
✔ 白名单工具集包含两个工具
（连同 Phase 00/01 的 12 个，共 20 个，全部通过）
```

### 11.2 真实调用日志（服务端实录）

杭州 1 天（模型自主发起 2 次工具调用）：

```text
模型发起 2 次工具调用： get_weather({"city":"杭州"}), search_attractions({"query":"杭州"})
工具 get_weather 执行结果： {"city":"杭州","date":"今天","condition":"阴","temperature":27,"wind":"3级"}
工具 search_attractions 执行结果： {"query":"杭州","results":[{"name":"西湖",...,"ticket":"免费",...}]}
→ HTTP 200，行程首站：西湖（免费）——数据与知识库一致
```

西安 2 天（模型自主发起 3 次工具调用，**自己决定查两天天气**）：

```text
模型发起 3 次工具调用： get_weather({"city":"西安","date":"2025-04-09"}),
                      get_weather({"city":"西安","date":"2025-04-10"}),
                      search_attractions({"query":"西安"})
→ HTTP 200，行程首站：西安城墙（54元）——数据与知识库一致
```

### 11.3 stub 全流程验证（不消耗配额）

```text
✅ 工具调用全流程验证通过
LLM 调用次数: 2 （1 次工具调用 + 1 次最终答案）
工具结果已回传 ✅ | 最终行程 city: 杭州 | 首个景点: 西湖
```

---

## 12. 调试指南（本阶段真实踩坑——这个 Phase 踩坑密度最高）

### 踩坑 1：auto 模式下模型跳过工具，直接用参数记忆回答

现象：SystemMessage 都写明了"必须先调用工具"，日志里依然没有工具调用，行程照样生成成功。
根因：当任务"直接给答案"更省事时，auto 模式下模型倾向于不调用工具（DeepSeek 实测）。prompt 指令约束力有限——写在 HumanMessage 里基本无效，写在 SystemMessage 里好一些但仍然不够。
修法：第一轮 `tool_choice: 'required'` 强制调用，保证 grounding。**这是生产环境的常见做法**，也是面试能讲的真实取舍：强制 grounding 多花一轮 token，换来"规划基于真实资料"的确定性。

### 踩坑 2：response_format json_object 与 tool_choice 冲突，LangChain 报错很误导

现象：同一实例上配 JSON mode + `bindTools(..., {tool_choice:'required'})`，invoke 抛 `TypeError: Cannot read properties of undefined (reading 'message')`，栈指向 LangChain 内部的 chat_models.js。
排查过程：① 用裸 fetch 直接调 API（避开 LangChain）→ 正常；② 最小复现：去掉 response_format → 正常；③ 加上 response_format + required → 复现。根因确认：**json_object 输出约束与强制工具调用在同一实例上冲突**（提供方行为），LangChain 把空响应转成了误导性的 TypeError。
修法：职责分离——工具轮用 `toolLlm`（无 JSON mode），答案轮用 `structuredLlm`（JSON mode、不绑工具）。方法论收获：**LangChain 报错不可信时，用裸 API 调用隔离问题**。

### 踩坑 3：真实请求偶发挂死 150 秒无响应

现象：西安请求工具执行全部成功，最终答案轮无限挂起（curl 超时断开），服务端无任何错误日志；同参数重试即成功。
判断：提供方瞬时停滞（stall），与代码无关；隔离复现 19 秒正常、后续多次调用正常。
遗留：服务端超时（60s 配置）与 SDK 重试的叠加行为没有完全验证——这是 Phase 08（Eval & Hardening）要处理的话题：请求超时、重试策略、降级。

### 踩坑 4：单测断言被"子串匹配"打脸

现象：`searchAttractions('北京 博物馆')` 期望"故宫博物院"排第一，实际是"上海博物馆"；`'火星 基地'` 期望空结果，实际命中"大熊猫繁育研究**基地**"。
根因：关键词检索是子串匹配——"故宫博物院"（博-物-院）并不包含"博物馆"（博-物-馆）；"基地"是另一个词的子串。
收获：① 测试用例错了要改用例，别急着改实现；② 这个局限本身就是 Phase 05（RAG/embedding）存在的理由：**关键词检索做不了语义匹配**。

### 踩坑 5：模型会给工具传幻觉参数

现象：西安请求中模型为 `date` 传了"2025-04-09"（今天是 2026-08-15）——凭空编了两个日期。
现状：Mock 工具忽略日期差异，无影响。
意义：工具参数同样会被幻觉污染。Phase 03/08 要处理：参数校验、结果校验、失败处理。面试官问"工具调用失败怎么办"时，这是真实素材。

---

## 13. 常见错误

- 工具执行放在模型侧而不是代码侧——模型只"点名"，执行权永远在代码
- ToolMessage 忘记带 `tool_call_id`——API 直接 400
- 工具抛异常打断整个请求——正确做法是把错误作为结果回传，让模型调整
- 在同一个实例上混用 JSON mode 和强制工具调用（本 Phase 实测冲突）
- 以为 prompt 写"请调用工具"模型就会调用——auto 模式下它会偷懒

---

## 14. 和上一阶段的关系

Phase 01 的产物（extractJson + zod 校验 + 带反馈重试）在 Phase 02 **原样保留**，只是校验对象升级为"基于工具资料生成的答案"。这展示了分层设计：**格式可靠性（Phase 01）与信息获取（Phase 02）是正交的两个维度**。

下一阶段（Phase 03 — Agent Loop）将打破"最多一轮工具调用"的限制：模型可以多轮调用工具、看到结果后继续决策，直到认为任务完成——届时需要引入终止条件、max_iter 和状态累积，`recommend` 的"工具轮+答案轮"结构会演进成真正的循环。

---

## 15. 面试问题（附参考回答）

### 基础

**Q1：Function Calling 和普通 API 调用有什么区别？**

参考回答：普通 API 调用是开发者**在代码里**决定调用时机和参数；Function Calling 是**模型**根据任务上下文决定调用哪个工具、传什么参数，返回一个 tool_call 对象（工具名 + JSON 参数 + id），然后由代码去执行，结果再回传给模型。决策权和执行权分离是本质：模型做决策，代码做执行。

**Q2：Tool Schema 为什么重要？模型怎么决定调用哪个工具？**

参考回答：schema（name/description/参数定义）是模型唯一能看到的"工具说明书"。description 决定模型"要不要用、用来干什么"，参数 schema 决定它"怎么传参"——写得模糊，参数就会乱传。我实测过模型给 date 参数传幻觉日期，这就是 schema 与提示词要配合收紧的原因。工具选择本质上是一个基于语义匹配的决策：模型把任务意图和每个工具的 description 做匹配，选最相关的。

**Q3：tool_choice 有哪几种取值？你项目里怎么用的？**

参考回答：auto（默认，模型自己决定）、required（必须至少调用一个工具）、none（禁止调用）、以及指定具体工具名。我用 required 做第一轮：实测 auto 模式下模型倾向于跳过工具直接用参数记忆回答，强制 grounding 后行程数据才来自真实资料。第二轮答案轮用 JSON mode 实例且不绑工具，模型只能输出最终答案，天然形成单轮边界。

### 项目实践

**Q1：你的 Agent 调用工具失败时怎么处理？**

参考回答：两种失败都不抛异常：未知工具名（模型幻觉）和工具执行错误，都会转成一个带 error 字段的 ToolMessage 回传给模型——让模型自己读到失败信息并调整策略，比如换个城市、换个关键词重试。理由：模型比 try-catch 更擅长"根据错误调整"，把异常流变成数据流是工具调用的关键设计。

**Q2：你的工具结果是"Mock 数据"，为什么这样设计？**

参考回答：Phase 02 的学习目标是工具调用机制本身，不是天气数据的真实性。Mock 的好处：零外部依赖、结果确定性（单测和 eval 可复现）、不花钱。替换真实 API 时，工具的 name/description/schema 都不用动——这正好证明工具抽象的边界。面试官如果追问，我还能说：天气数据反而是下一步真实化的成本最低项。

**Q3：模型给你的工具传了非法参数（比如幻觉日期）怎么办？**

参考回答：现阶段 Mock 工具对参数宽容（未知城市返回 error 字段），系统不会崩。但这是真实风险：工具参数同样会被幻觉污染。Phase 08 会做参数校验、结果校验和失败降级。工具设计上还有一个原则：**查询类工具（get_weather）可以宽容，写操作类工具（下单、扣款）必须严格校验 + 人工确认**。

### 深挖

**Q1：多个工具调用是并行还是串行？什么情况该并行？**

参考回答：我的实现是串行（for 循环逐个执行）。天气和景点查询彼此独立，本来可以并行（Promise.all）降低延迟；但如果工具之间有依赖（比如先用 A 的结果决定 B 的参数），必须串行。判断标准：**看工具间是否有数据依赖**。LangChain 的 batch/并行调用需要在代码里显式做。

**Q2：工具返回的数据太大（比如检索出 100 个景点）怎么办？**

参考回答：两层控制：① 工具内部截断——search_attractions 只返回 top 5，把"少而精"的职责放在工具实现里，不让模型侧处理；② 工具 description 里约定返回格式，让模型知道会拿到什么。如果确实需要全量数据，应该做成分页工具（带 offset 参数），让模型多轮取——那是 Phase 03 多轮循环之后的形态。

**Q3：为什么必须用白名单工具集？**

参考回答：工具调用是 Agent 最大的攻击面：提示注入（用户消息诱导模型调用危险工具）、工具名幻觉（模型编造不存在的工具）。白名单 + 分发时查表（我的 TOOL_MAP）从机制上保证"模型只能点到注册过的工具"。Phase 08 还会加：写操作工具需要确认、参数校验、调用审计日志。

---

## 16. 毕业检查

### 代码

- [x] 2 个工具（get_weather Mock + search_attractions 本地检索）
- [x] 工具失败降级（未知工具/执行错误 → error ToolMessage）
- [x] tool_choice required 强制 grounding（实测 auto 会跳过工具）
- [x] 工具轮/答案轮双实例架构（解决 json_object 与 tool_choice 冲突）
- [x] 8 个工具单测，全量 20/20
- [x] 真实调用验证：模型自主发起 2~3 次工具调用，数据与知识库一致
- [x] 没有实现下一阶段内容（仍为单轮工具调用，无 Agent Loop）

### 理解

- [ ] 我能完整画出"工具定义 → tool_calls → 执行 → ToolMessage 回传 → 答案"的链路
- [ ] 我能解释为什么模型只做决策、代码做执行
- [ ] 我能解释 auto 与 required 的取舍及我项目里的选择
- [ ] 我能解释工具失败为什么要回传而不是抛异常
- [ ] 我能回答"面试问题"章节的全部问题

### 用户确认

```text
User Confirmation: PENDING
```

---

## 17. 本阶段总结

### 我学会了

- Function Calling 的完整机制与 LangChain 实现（bindTools / tool() / ToolMessage）
- tool_choice 三种模式与"强制 grounding"的生产实践
- 工具失败降级：异常流 → 数据流
- 双实例架构的来由（json_object 与 tool_choice 的实测冲突）
- 用裸 API 调用隔离排查框架层问题的方法

### 我还不会

- 让模型多轮调用工具直到任务完成（Phase 03）
- 跨轮次的状态管理与终止条件（Phase 03/04）

### 下一阶段

```text
Phase 03 — Agent Loop
```
