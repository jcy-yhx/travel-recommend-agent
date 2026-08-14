# Phase 01 — Structured Output

## 1. 本阶段目标

本阶段结束后，我能够：

> 把 LLM 的非稳定文本输出升级为可验证的结构化旅游计划，并能讲清 JSON mode、schema 校验、失败重试三者如何配合。

---

## 2. 为什么学习这个？

### 上一阶段遗留的问题

Phase 00 的 `recommend` 靠正则从模型输出里"捞" JSON：

```js
const match =
    fullResponse.match(/```json\s*([\s\S]*?)\s*```/) ||
    fullResponse.match(/```\s*([\s\S]*?)\s*```/) ||
    fullResponse.match(/\{[\s\S]*\}/)   // 贪婪匹配，脆弱
```

它有三个硬伤：
1. **没有格式保证**：模型想输出什么格式就输出什么，围栏、前后缀文本、markdown 都可能出现
2. **没有字段保证**：即使 JSON 解析成功，`dailyItinerary` 可能缺失、`totalBudget` 可能是字符串——前端拿到"看起来对"的数据，渲染时悄悄出错
3. **失败即终局**：解析失败直接返回错误，没有第二次机会

### 新技术解决什么问题？

三层防线，逐层兜底：

| 防线 | 机制 | 防什么 |
|---|---|---|
| 1. JSON mode | `response_format: json_object`，模型只输出合法 JSON | 语法错误、围栏、前后缀文本 |
| 2. schema 校验 | zod 定义 `TravelPlanSchema`，字段级校验 | 字段缺失、类型错误 |
| 3. 失败重试 | 把校验错误反馈给模型重试，最多 2 次 | 偶发的不合规输出 |

### 如果不用它？

上游任何一层缺失，下游都要写防御代码：前端拿到数据先做一堆 `if (data.dailyItinerary)` 判断；模型偶尔发疯一次，整个请求直接失败。结构化输出是把"信任模型"变成"验证模型"——这是 Agent 项目最重要的工程习惯之一。

---

## 3. 核心概念

- **Structured Output**：让 LLM 的输出满足预定义的数据结构，而非自由文本
- **JSON mode**（`response_format: {type:'json_object'}`）：OpenAI 兼容接口的能力，模型只输出合法 JSON；注意官方要求 prompt 中必须出现 "JSON" 一词
- **zod schema**：声明式描述数据契约（`z.object` / `z.string` / `z.number` / `z.array`），`safeParse` 返回字段级错误
- **带反馈的重试（recovery loop）**：失败后不是盲目重发，而是把错误信息拼进下一轮 prompt，让模型自我修正
- **temperature 分区**：聊天用 0.7（自然多样），结构化输出用 0.2（稳定复现结构）
- **错误信息反馈**：`summarizeZodError` 把 zod 的 `error.issues` 翻译成模型能理解的文字

---

## 4. 本阶段不学习什么

- 不学 Tool Calling——用工具强制结构是另一种 Structured Output 方案，**留给 Phase 02 做对比**
- 不学 Agent Loop——本阶段的"调用→校验→重试"循环是雏形，但还不是 Agent
- 不学向量/RAG/多智能体
- 不新增依赖（zod 是本 Phase 的核心依赖，已经你确认）

---

## 5. 当前代码状态（Phase 00 结束时的 recommend）

```text
TravelService.recommend
  → prompt 模板（内嵌 JSON 示例 + "success": true 字段）
  → llm.invoke（temperature 0.7，与聊天共用实例）
  → 正则提取 JSON（```json 围栏 / 通用围栏 / 贪婪 {…}）
  → JSON.parse 失败 → 返回 {success:false}（HTTP 200，双层信封）
  → 无重试、无字段校验
```

---

## 6. 本阶段目标架构

```text
TravelService.recommend
  → structuredLlm.invoke（temperature 0.2 + JSON mode，独立实例）
  → extractJson（围栏优先，裸 JSON 兜底）
  → JSON.parse → TravelPlanSchema.parse（zod 字段级校验）
  → 失败 → summarizeZodError 反馈 → 重试（最多 2 次）
  → 重试耗尽 → 抛异常 → 全局错误中间件返回 500
  → 成功 → 返回已校验的纯数据（无 success 字段，契约交给 HTTP 状态码）
```

---

## 7. 文件变化

### 新增

```text
travel-recomend-backend/src/services/travelPlanSchema.js        # zod schema + 错误摘要
travel-recomend-backend/src/utils/extractJson.js                # 三级 JSON 提取
travel-recomend-backend/src/__tests__/structuredOutput.test.js  # 7 个确定性单测
```

### 修改

```text
travel-recomend-backend/src/services/travelService.js           # 双 LLM 实例 + 重试循环 + prompt 更新
travel-recomend-backend/src/routes/travel.js                    # 删除 success 内层判断（service 只返回数据或抛错）
travel-recomend-backend/package.json                            # 新增 zod 依赖
travel-recomend-front/src/views/detail.vue                      # TripData 去掉 success 字段
```

---

## 8. 关键代码

### 8.1 zod schema：数据契约

```js
// src/services/travelPlanSchema.js（节选）
const TravelSegmentSchema = z.object({
    spot: z.string(),
    duration: z.string(),
    ticket: z.string(),
    transportation: z.string(),
    description: z.string()
})

export const TravelPlanSchema = z.object({
    city: z.string(),
    days: z.number(),
    totalBudget: z.number(),
    dailyItinerary: z.array(z.object({
        day: z.number(),
        date: z.string(),
        morning: TravelSegmentSchema.optional(),
        afternoon: TravelSegmentSchema.optional(),
        evening: TravelSegmentSchema.optional()
    })),
    budgetBreakdown: z.object({ /* 5 个数字字段 */ }).optional(),
    tips: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional()
})
```

**解释**：schema 就是"数据契约"——模型输出必须长成这样，否则视为失败。`optional()` 表达"可缺省"，`z.array` / `z.object` 支持嵌套。注意：LLM 输出里**不再有 `success` 字段**，成功与否由 HTTP 状态码 + 校验结果决定，模型只返回纯数据。

### 8.2 带反馈的重试循环

```js
// src/services/travelService.js（节选）
const MAX_RETRIES = 2

async recommend(city, budget, days) {
    const messages = [this.getTravelPrompt(city, budget, days)]
    let lastError = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await this.structuredLlm.invoke(messages)
            const json = JSON.parse(extractJson(response.content))
            return TravelPlanSchema.parse(json)
        } catch (error) {
            lastError = error
            const reason = summarizeZodError(error) || error.message
            // 关键：把错误反馈给模型，而不是盲目重发同一请求
            messages.push(new HumanMessage(
                `你上一次的输出无法解析，错误信息：${reason}。` +
                `请重新输出，必须严格符合要求的结构，且只输出 JSON 对象本身。`
            ))
        }
    }
    throw new Error(`模型输出解析失败（已重试 ${MAX_RETRIES} 次）：…`)
}
```

**解释**：这是"调用 → 提取 → 校验 → 失败反馈 → 再调用"的闭环。与盲目重试的区别：第二次请求携带了**具体错误**（如"字段 dailyItinerary.0.morning.ticket 校验失败：expected string"），模型知道自己错在哪。这个循环是 Phase 03 Agent Loop 的雏形——区别在于这里循环的终点固定是"拿到合法 JSON"，Agent Loop 的终点由任务本身决定。

### 8.3 双 LLM 实例（temperature 分区）

```js
// 聊天用：高温度，回答自然
this.llm = new ChatOpenAI({ ...baseConfig, temperature: 0.7, streaming: true })

// 结构化输出用：低温 + JSON mode
this.structuredLlm = new ChatOpenAI({
    ...baseConfig,
    temperature: 0.2,
    modelKwargs: { response_format: { type: 'json_object' } }
})
```

**解释**：temperature 控制采样随机性。0.7 适合创意/对话，但用于结构化输出会"偶尔换个说法"导致字段不稳定；0.2 让模型稳定复现结构。一个实例负责一件事，比每次调用时改配置更清晰。

### 8.4 extractJson 三级提取

```js
// src/utils/extractJson.js
export function extractJson(text) {
    const fenced = text.match(/```json\s*([\s\S]*?)\s*```/)
    if (fenced) return fenced[1]
    const generic = text.match(/```\s*([\s\S]*?)\s*```/)
    if (generic) return generic[1]
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) return text.slice(start, end + 1)
    throw new Error('模型输出中找不到 JSON 对象')
}
```

**解释**：JSON mode 开启后模型只输出 JSON，extractJson 变成**兜底**（比如未来换成不支持的模型时仍能工作）。已知局限写在注释里：贪婪匹配遇到 JSON 后带 `}` 的尾随文本会失败——这也是为什么 JSON mode 是主线。

---

## 9. 完整数据流

```text
User → detail 页请求
 ↓
路由层（参数校验 400）
 ↓
TravelService.recommend
 ↓  attempt 0..2
structuredLlm（0.2 低温 + JSON mode）
 ↓ 返回文本
extractJson → JSON.parse → TravelPlanSchema.parse
 ├─ 失败 → summarizeZodError → 拼入下轮 prompt → 回到 structuredLlm
 └─ 成功 → 返回已校验数据
 ↓
{success:true, data: 行程} → 前端直接渲染（无需防御式判断）
 ↓
重试耗尽仍失败 → throw → 全局错误中间件 → 500 {success:false, message}
```

---

## 10. 运行方式

```bash
cd travel-recomend-backend
npm install    # 新增 zod 依赖
npm run dev    # 或 npm start
npm test       # 12 个测试（5 冒烟 + 7 结构化输出单测）

cd travel-recomend-front
npm run build  # 类型检查 + 构建
```

验证接口：

```bash
curl -X POST http://127.0.0.1:3300/api/travel/recommend \
  -H 'Content-Type: application/json' \
  -d '{"city":"成都","budget":1500,"days":2}'
```

---

## 11. 测试

### 11.1 确定性单测（npm test 真实输出）

```text
✔ 提取 ```json 围栏中的 JSON
✔ 提取无围栏的裸 JSON（前后有说明文字）
✔ 模型输出中完全没有 JSON 时抛错（触发重试）
✔ 合法行程通过校验
✔ 缺少 dailyItinerary 字段时校验失败（触发重试）
✔ ticket 是数字（schema 要求字符串）时校验失败（触发重试）
✔ 预算字段是字符串（schema 要求数字）时校验失败（触发重试）
（连同 Phase 00 的 5 个冒烟测试，共 12 个，全部通过）
```

### 11.2 重试循环验证（stub LLM，不消耗配额）

用 stub 替换 `structuredLlm`：第 1 次返回纯文本（无 JSON），第 2 次返回合法 JSON：

```text
✅ 重试循环验证通过：首次输出无效 → 重试后成功
LLM 调用次数: 2 （1 次失败 + 1 次成功）
返回数据 city: 测试市 | days: 1
```

### 11.3 JSON mode 探测（真实 API）

```text
输入 prompt: 输出一个 JSON 对象：{"probe": "ok"}
返回内容: {"probe": "ok"}
结论：SiliconFlow 的 DeepSeek 模型支持 response_format json_object ✅
```

### 11.4 真实调用（严格 schema，零重试通过）

```text
POST {"city":"成都","budget":1500,"days":2}  → HTTP:200，一次通过
POST {"city":"上海","budget":2000,"days":3}  → HTTP:200，一次通过（耗时 40s）
返回数据示例（已无 success 字段）：
{"success":true,"data":{"city":"成都","days":2,"totalBudget":1500,
 "dailyItinerary":[{"day":1,"morning":{"spot":"宽窄巷子","ticket":"免费",...}}]}}
```

---

## 12. 调试指南（本阶段真实踩坑）

### 踩坑 1：extractJson 返回字符串，直接喂给 zod 导致"expected object, received string"

现象：stub 验证时输出 `字段 "" 校验失败：Invalid input: expected object, received string`。
检查：`extractJson` 的职责是**提取子串**，返回的是 string；`JSON.parse` 是独立的第二步。我第一版代码漏了 `JSON.parse`，zod 拿到字符串当然报"期望对象"。
教训：验证"提取"和"解析"是两个不同的失败点，都要进 catch、都要触发重试。

### 踩坑 2：如何探测模型是否支持 JSON mode？

不要猜，用最小代价实测：一个 `{"probe":"ok"}` 的调用，几 token 就能确认能力。如果模型不支持（返回 400），fallback 方案就是"只靠 prompt + extractJson + 重试"，代码里 extractJson 保留三级提取正是为此。

### 踩坑 3：本机 3300 端口被 nodemon 占用

现象：后台启动 `node src/index.js` 报 EADDRINUSE。
检查：自己之前跑的 `npm run dev`（nodemon）还活着，并且会监听文件变化自动重载——所以 curl 打到的其实是最新代码。
教训：开发时 nodemon 常驻是正常现象；验证前先确认打到的服务是哪个进程、哪份代码（本次通过"响应里没有 success 字段"确认是新代码在服务）。

---

## 13. 常见错误

- 把 `JSON.parse` 和"提取 JSON"混在一步做，出错时不知道是哪一步失败
- JSON mode 的 prompt 里没出现 "JSON" 一词（部分模型会拒绝 json_object 请求）
- 用同一个高温 LLM 实例做结构化输出，格式时好时坏
- 重试时不带错误反馈，只是机械重发同一个 prompt——浪费 token 且大概率再失败
- 让 LLM 输出里携带 `success` 字段——成功与否是传输层/校验层的事，模型输出纯数据即可

---

## 14. 和上一阶段的关系

上一阶段（Phase 00）建立了错误处理的骨架：asyncHandler、统一响应契约、smoke test。本阶段在骨架上解决**数据可靠性**：同样的"失败就走 500"契约，但把"模型输出不可靠"这个最大的失败源收进 schema + 重试的管理范围。

下一阶段（Phase 02 — Tool Calling）会引入工具：天气、景点检索。届时你将对比——**用工具强制结构（tool_choice）也是 Structured Output 的一种方案**，面试官极可能追问这个对比。

---

## 15. 面试问题（附参考回答）

### 基础

**Q1：什么是 Structured Output？为什么 LLM 应用需要它？**

参考回答：Structured Output 是让 LLM 的输出满足预定义结构（schema）而不是自由文本。需要它的原因：下游代码（前端渲染、数据库写入、工具调用）要求稳定的数据形状，而 LLM 输出本质上是采样产生的文本，字段缺失、类型漂移、格式包裹都可能发生。我的做法是三层防线：JSON mode 保证语法、zod schema 保证字段契约、带反馈的重试兜底偶发失败。

**Q2：JSON mode 和在 prompt 里说"请输出 JSON"有什么区别？**

参考回答：prompt 要求只是"请求"，模型可以不遵守；JSON mode（`response_format: json_object`）是推理层面的约束，服务端保证输出是合法 JSON，从源头消灭语法错误和围栏问题。但它不能保证字段结构——所以 schema 校验依然必要。另外官方要求 prompt 中必须出现 "JSON" 一词，否则请求可能被拒绝。

**Q3：temperature 对结构化输出有什么影响？你项目里怎么设的？**

参考回答：temperature 控制采样随机性，值越高输出越多样、越不可控。我用两个实例：聊天 0.7（自然多样），结构化输出 0.2（稳定复现结构）。面试加分点：如果你的模型支持，结构化输出场景还可以用更底层的约束（如 tool_choice 强制）。

### 项目实践

**Q1：模型输出校验失败后你的系统怎么处理？**

参考回答：调用 → 提取 → 解析 → zod 校验，任何一步失败都进入重试循环（最多 2 次）。关键设计是**带反馈的重试**：用 `summarizeZodError` 把字段级错误（如"dailyItinerary.0.morning.ticket 期望字符串"）拼进下一轮 prompt，模型知道自己错在哪，修正成功率远高于盲目重发。重试耗尽后抛异常，由全局错误中间件返回 500。

**Q2：你的 zod schema 有哪些设计取舍？**

参考回答：三个取舍。① 上午/下午/晚上用 `optional()`——不是每天都有三个时段；② `budgetBreakdown` 整个可选——它是辅助信息，缺失不该让整个请求失败；③ ticket/duration 严格要求字符串——prompt 里明确写了"如'60元'或'免费'"，模型偶尔返回数字会被校验拦下、靠重试修正，而不是放宽 schema 纵容类型漂移。

**Q3：如果模型连续 3 次输出非法 JSON，接口会发生什么？**

参考回答：三次尝试（首次 + 2 次重试）全部失败后，service 抛出带累计错误信息的异常，全局错误中间件返回 500 和明确的 message，前端显示错误页并可"重新规划"。不会崩溃、不会挂起、不会返回半成品数据——这是 Phase 00 建立的错误处理骨架在起作用。

### 深挖

**Q1：JSON mode 和 tool calling 强制结构，你选哪个？**

参考回答：当前场景选 JSON mode——行程规划只需要"一个结构化输出"，不需要模型"决定调用什么"，工具是下一阶段要解决的问题（把重头戏留给 Phase 02）。tool calling 强制结构（tool_choice）的好处是 schema 在工具定义里天然存在、模型不生成对象就报错，坏处是输出藏在工具调用参数里、链路更重。两者都依赖 schema 校验做最后防线。

**Q2：带反馈的重试会放大 token 消耗，怎么控制？**

参考回答：三个手段：① 重试次数上限（2 次）；② 反馈信息只截取前 3 条校验错误，不把整个 zod error 对象灌进 prompt；③ 第一道防线做好（JSON mode + 低温），实测目前真实调用零重试——重试是保险丝，不是常态。

---

## 16. 毕业检查

### 代码

- [x] JSON mode 启用（实测模型支持）
- [x] zod schema 校验 + extractJson 三级提取
- [x] 失败重试 ≤2 次（带错误反馈）
- [x] temperature 分区（聊天 0.7 / 结构化 0.2）
- [x] 单测 7 个 + 冒烟 5 个全部通过
- [x] 真实调用 2 次全部一次通过
- [x] 没有实现下一阶段内容（没有引入 Tool / Loop）

### 理解

- [ ] 我能解释三层防线各自的职责（JSON mode / schema / 重试）
- [ ] 我能说出带反馈重试和盲目重试的区别
- [ ] 我能解释为什么 schema 里去掉 success 字段
- [ ] 我能回答"JSON mode vs tool forcing"的对比
- [ ] 我能回答"面试问题"章节的全部问题

### 用户确认

```text
User Confirmation: PENDING
```

---

## 17. 本阶段总结

### 我学会了

- Structured Output 的三层防线设计与各自边界
- zod 声明式 schema：`safeParse` 与字段级错误信息
- 带反馈的重试循环：错误信息如何拼进 prompt
- JSON mode 的启用条件与探测方法
- temperature 与输出稳定性的关系

### 我还不会

- 让模型自己决定"调用什么工具"（Phase 02）
- Agent 的自主循环与终止（Phase 03）

### 下一阶段

```text
Phase 02 — Tool Calling
```
