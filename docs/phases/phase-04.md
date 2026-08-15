# Phase 04 — State / Memory

## 1. 本阶段目标

本阶段结束后，我能够：

> 让 Agent 能够保存和使用多轮旅游规划状态：同一会话里记住说过的话、记住刚规划的行程，并且服务重启后不丢失。能区分 State 与 Memory 两个概念。

---

## 2. 为什么学习这个？

### 上一阶段遗留的问题

Phase 03 的 messages 数组只活在**单次请求**里：每轮对话都是"失忆"的，模型不知道你上一句说过什么；规划好的行程也随响应结束而蒸发。真实用户不会只问一句——"把第二天改成西湖"这种追问必须建立在状态之上。

### 新技术解决什么问题？

| 能力 | 说明 |
|---|---|
| 多轮记忆 | 同一会话内，模型记得之前说过的话（"我叫小王"→"我叫什么？"） |
| 任务状态 | 行程草案保存在会话里，chat 能引用它（"我规划的行程是哪里？"） |
| 持久化 | 服务重启后状态从磁盘恢复（实测通过） |
| 会话隔离 | 不同 sessionId 的状态互不可见（多用户的基础） |

### 如果不用它？

- 每句话都是第一句——多轮对话根本不存在
- 规划结果无法被追问、修改、引用
- 面试官问"你的 State 存哪、多用户怎么办"时没有代码支撑

---

## 3. 核心概念

**State vs Memory（面试必考的区分）**：

| | State | Memory |
|---|---|---|
| 含义 | 任务执行期间的**运行状态** | 跨任务/跨会话的**长期信息** |
| 例子 | 本轮对话历史、当前行程草案 | "这个用户喜欢徒步旅行" |
| 生命周期 | 随任务结束而结束（或随会话存续） | 跨会话长期保留 |
| 本项目的实现 | 本阶段：sessionId → { history, tripPlan } | 本阶段：概念级（真正落地需用户画像 + 检索，面试后再做） |

**本阶段实现的三板斧**（刻意克制）：
1. **内存 Map**：`sessionId → state`，请求间 O(1) 读写
2. **JSON 文件持久化**：进程重启恢复；学习规模足够，**不上 Redis/数据库**——面试被问"为什么不上"时能答出理由：规模未到、单机单进程够用、演进路径明确
3. **历史裁剪**：滑窗保留最近 20 条（MAX_HISTORY），防止上下文无限增长

**会话 ID 的传递链**：前端 localStorage 保存 → 每次请求带上 → 服务端 ensureSession（存在则复用，否则新建）→ done 事件返回新 ID → 前端更新。这条链断一节，多轮记忆就失效。

---

## 4. 本阶段不学习什么

- 不学数据库/Redis——JSON 文件够用，演进路径写进文档即可
- 不学向量记忆/用户画像——那是真正的 Memory，面试后内容
- 不学会话过期/清理策略——Phase 08 生产化话题
- 不学多用户鉴权——sessionId 是匿名会话，登录体系不属于本项目范围

---

## 5. 当前代码状态（Phase 03 结束时）

```text
chat：无历史（每轮消息独立组装 System + Human）
recommend：行程生成后直接返回，无任何留存
服务重启 → 一切归零
```

---

## 6. 本阶段目标架构

```text
                         ┌──────────────────────────────┐
                         │ StateManager                  │
                         │  内存 Map: sessionId → state   │
                         │  ┌─────────────────────────┐  │
                         │  │ state = {                │  │
                         │  │   history: 最近20条消息,  │  │
                         │  │   tripPlan: 行程草案      │  │
                         │  │ }                        │  │
                         │  └─────────────────────────┘  │
                         │  JSON 文件持久化（重启恢复）    │
                         └──────────┬───────────────────┘
                                    │
        ┌───────────────────────────┼────────────────────┐
        ▼                           ▼                    ▼
   /chat（SSE）               /recommend             /chat 下一轮
   历史 + tripPlan 注入        行程生成后              记得上一轮 + 行程
   SystemMessage               setTripPlan 存草案      可引用、可追问
```

---

## 7. 文件变化

### 新增

```text
travel-recomend-backend/src/services/stateManager.js      # StateManager 类 + 单例
travel-recomend-backend/src/__tests__/stateManager.test.js # 6 个状态测试
```

### 修改

```text
travel-recomend-backend/src/services/travelService.js
    # chat 带会话历史；recommend 成功后 setTripPlan；buildChatSystemPrompt
travel-recomend-backend/src/routes/travel.js
    # 两个接口都处理 sessionId（ensureSession）；done 事件携带 sessionId
travel-recomend-backend/src/utils/streamUtils.js
    # done(data) 支持附加数据
travel-recomend-front/src/views/chat.vue
    # localStorage 保存 sessionId；done 事件提取并更新
travel-recomend-front/src/views/detail.vue
    # 规划时携带 sessionId；响应中的 sessionId 写回 localStorage
.gitignore
    # 忽略运行时数据 sessions.json
```

---

## 8. 关键代码

### 8.1 StateManager 核心

```js
// src/services/stateManager.js（节选）
export class StateManager {
    constructor(filePath = DEFAULT_SESSIONS_FILE) {
        this.filePath = filePath
        this.sessions = new Map()   // sessionId → state（内存，请求间快速读写）
        this.loadFromDisk()         // 启动时从 JSON 文件恢复
    }

    ensureSession(sessionId) {
        // 已有则复用；没有则新建（传入的 ID 无效时也按新会话创建）
        if (sessionId && this.sessions.has(sessionId)) {
            return this.sessions.get(sessionId)
        }
        const id = sessionId || randomUUID()
        const session = { sessionId: id, createdAt: ..., history: [], tripPlan: null }
        this.sessions.set(id, session)
        this.persist()
        return session
    }

    appendMessage(sessionId, role, content) {
        const session = this.sessions.get(sessionId)
        if (!session) return null
        session.history.push({ role, content, at: ... })
        // 滑窗裁剪：只保留最近 MAX_HISTORY(20) 条
        if (session.history.length > MAX_HISTORY) {
            session.history = session.history.slice(-MAX_HISTORY)
        }
        this.persist()
        return session
    }
}
```

**解释**：双写策略——内存 Map 保证请求内快速读写，JSON 文件保证重启不丢。`ensureSession` 的幂等语义是会话链的关键：客户端无论传不传 ID、传的 ID 是否还有效，都能拿到一个可用会话。

### 8.2 chat 的状态使用

```js
// src/services/travelService.js（节选）
async chat(sessionId, message, streamCallback) {
    const session = stateManager.getSession(sessionId)

    const messages = [
        new SystemMessage(this.buildChatSystemPrompt(session)),   // 含行程草案上下文
        ...(session?.history ?? []).map(m =>
            m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
        ),
        new HumanMessage(message)
    ]
    // ...流式调用后：
    stateManager.appendMessage(sessionId, 'user', message)
    stateManager.appendMessage(sessionId, 'assistant', fullResponse)
}

buildChatSystemPrompt(session) {
    let prompt = '你是一个友好热情的旅游助手...'
    if (session?.tripPlan) {
        prompt += `\n用户当前的行程草案：${session.tripPlan.city} ${session.tripPlan.days} 天，总预算 ${session.tripPlan.totalBudget} 元。...`
    }
    return prompt
}
```

**解释**：历史消息直接映射为 LangChain 消息对象拼进上下文；行程草案以自然语言注入 SystemMessage（比结构化注入简单，效果足够）。**成功才写回**——失败的那轮不污染历史。

---

## 9. 完整数据流

```text
前端（localStorage: travel_session_id）
  │  POST /chat {message, sessionId}
  ▼
路由 ensureSession(sessionId) → 复用或新建
  ▼
chat：SystemMessage（角色 + 行程草案） + 历史20条 + 新消息
  ▼ LLM 流式回复
成功 → appendMessage(user) + appendMessage(assistant) → persist
  ▼
SSE done 事件 {type:'done', sessionId} → 前端存回 localStorage
  ▼
用户再规划行程：POST /recommend {city, budget, days, sessionId}
  ▼ recommend 成功 → setTripPlan(sessionId, plan) → persist
  ▼
下一轮 chat："我规划的行程是哪里？" → SystemMessage 里有草案 → 模型答对
  ▼
服务重启 → StateManager.loadFromDisk() → 一切还在
```

---

## 10. 运行方式

```bash
cd travel-recomend-backend
npm test       # 29 个测试
npm run dev
```

验证接口（注意观察 done 事件里的 sessionId）：

```bash
curl -N -X POST http://127.0.0.1:3300/api/travel/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"我叫小王，喜欢徒步"}'
```

---

## 11. 测试

### 11.1 确定性测试（npm test，29/29）

```text
✔ ensureSession 创建新会话并返回稳定 ID
✔ appendMessage 累积历史并写盘
✔ 历史裁剪：超过 MAX_HISTORY 只保留最近 N 条
✔ setTripPlan 保存行程草案
✔ 未知 sessionId 的 getSession 返回 null，appendMessage 返回 null
✔ 服务重启恢复：新实例从同一文件恢复会话（持久化）
（连同 Phase 00-03 的 23 个，共 29 个，全部通过）
```

### 11.2 真实调用实录（完整五步验证链）

```text
① 首轮对话（无 sessionId）→ 服务端新建会话，done 事件返回 sessionId
   模型："你好，小王！...你是一位喜欢徒步旅行的旅行者 🏔️"

② 多轮记忆（带 sessionId）→ "我刚才告诉你我叫什么？"
   模型："你叫小王，喜欢徒步旅行 😊"  ✅ 记忆生效

③ 规划杭州（带同一 sessionId）→ HTTP 200，行程草案写入该会话

④ 行程草案引用 → "我刚规划的行程是哪个城市？预算多少？"
   模型："你刚规划的行程是杭州，总预算为1000元，行程时长为1天"  ✅ 状态生效

⑤ 服务重启 → 日志：[StateManager] 从磁盘恢复 3 个会话
   同一 sessionId 再问"我叫什么？我之前的行程是哪里的？"
   模型："你叫小王，之前的行程是杭州（1天，总预算1000元）"  ✅ 持久化生效
```

---

## 12. 调试指南（本阶段真实踩坑）

### 踩坑 1：类忘记 export，测试在 import 阶段就崩

现象：`SyntaxError: The requested module does not provide an export named 'StateManager'`。
检查：新增模块时最容易漏的 `export` 关键字——测试文件级报错（不是断言失败）通常意味着 import 层问题，先看导出再看逻辑。
教训：新增模块的"第一个测试"应该是"能 import 进来"。

### 踩坑 2：会话链断在哪一节？先测链路两端

现象：前端 localStorage 没存上 sessionId 时，每句话都是新会话，表现就是"失忆"。
检查顺序：① done 事件里有没有 sessionId（curl 看原始 SSE）；② 前端有没有解析 done 事件；③ localStorage 有没有写入。curl 是排查会话问题最快的工具——**链路两端（服务端事件、浏览器存储）中间的任何一环断了，症状都一样**。

### 踩坑 3：curl 提取 sessionId 的正则写错

现象：`grep -o 'sessionId":"[^"]*'` 返回空，实际响应里有。
检查：直接 `curl -N ... | tail -2` 看原始 done 事件格式，再针对真实格式写提取表达式（`grep -oE '"sessionId":"[a-f0-9-]+"' | cut -d'"' -f4`）。
教训：解析工具输出前，先看原始输出长什么样。

---

## 13. 常见错误

- 把 State 和 Memory 混为一谈——面试必问的区分（见 §3 表格）
- 每次请求都新建会话（前端没存 sessionId）——症状就是永远失忆
- 历史不设上限——上下文无限增长，token 成本线性上升
- 失败轮次也写回历史——把"半截对话"污染进上下文
- 一上来就上 Redis/数据库——规模没到之前，JSON 文件 + 明确演进路径是更诚实的答案

---

## 14. 和上一阶段的关系

Phase 03 的 Agent Loop 在**单次请求内**循环；Phase 04 把状态生命周期拉长到**跨请求**。两者正交：Loop 管"这一次任务怎么做完"，State 管"下一次请求还记得什么"。它们共同构成了面试中"有状态的 Agent"的完整图景。

下一阶段（Phase 05 — RAG-lite）：目前景点检索是关键词子串匹配（Phase 02 就踩过"故宫博物院不含博物馆"的坑），Phase 05 用 embedding 做语义检索，解决"换一种说法就搜不到"的问题。

---

## 15. 面试问题（附参考回答）

### 基础

**Q1：Agent 里的 State 和 Memory 有什么区别？**

参考回答：State 是任务执行期间的运行状态，生命周期随任务/会话；Memory 是跨任务的长期信息。我项目里的例子：当前会话的对话历史和行程草案是 State（存在 sessionId 对应的状态里）；"这个用户喜欢徒步旅行"这种跨会话的偏好才是 Memory。我的系统里 Memory 目前是概念级的——聊天历史里能"记得"小王喜欢徒步，但那只是会话历史的一部分，不是独立的用户画像。真正落地 Memory 需要把偏好抽取出来结构化存储，面试后我会做。

**Q2：你的 State 存在哪里？多用户并发怎么隔离？**

参考回答：两层：内存 Map（sessionId → state，请求间 O(1) 读写）+ JSON 文件持久化（重启恢复）。并发隔离靠 sessionId——每个会话一个独立的 state 对象，前端 localStorage 保存自己的 sessionId，天然隔离。没有鉴权体系，sessionId 是匿名会话标识。规模再大时的演进路径：单机内存不够 → Redis（多实例共享）；持久化 → SQLite/PostgreSQL；文件写盘的同步操作 → 异步批量写。

**Q3：对话历史越来越长怎么办？**

参考回答：我做了滑窗裁剪——只保留最近 20 条消息，超出的丢最旧的。这是最朴素有效的策略。更进阶的手段：摘要压缩（把旧历史浓缩成一段摘要）、结构化状态（只存"结论"不存原文）、向量检索相关历史（Memory 的方向）。选型原则：先满足"能对话"，再谈"记得多"。

### 项目实践

**Q1：你的会话 ID 是怎么从前端传到后端的？断了会怎样？**

参考回答：localStorage 保存 → 每次 chat/recommend 请求带上 → 服务端 ensureSession 复用或新建 → done 事件把服务端最终采用的 sessionId 返回 → 前端写回。断链的症状是"永远失忆"：每句话都新建会话。排查方法：先 curl 看 done 事件有没有 sessionId，再看前端 localStorage——链路任何一环都能断。

**Q2：行程草案是怎么被 chat 引用的？**

参考回答：recommend 成功后把行程摘要（城市/天数/预算）存入会话状态的 tripPlan 字段；下一轮 chat 组装消息时，把这个摘要以自然语言注入 SystemMessage（"用户当前的行程草案：杭州 2 天，预算 1000 元……"）。实测模型能正确回答"我规划的行程是哪里"。选自然语言注入而不是结构化传递，是因为 LLM 对自然语言的上下文理解足够好，实现成本最低。

**Q3：你的会话状态什么时候会丢？怎么防？**

参考回答：两种丢失场景：① 服务重启——已用 JSON 文件持久化解决（实测重启后恢复）；② 文件损坏/误删——目前没有备份，生产环境会用数据库 + 定期备份。另外会话没有过期清理，无限增长的会话文件是 Phase 08 要处理的问题。

### 深挖

**Q1：为什么不用 Redis？**

参考回答：诚实回答：规模没到。当前是单机单进程、学习项目，内存 Map + JSON 文件完全够用，引入 Redis 增加运维复杂度却解决不了任何现实问题。什么时候该换：多实例部署需要共享状态时（内存 Map 只在本进程有效）、写入频率高到同步写盘成为瓶颈时。能说出"什么时候换、为什么现在不换"，比"用了 Redis"更有说服力。

**Q2：你的"记忆"真的是 Memory 吗？还是只是长上下文？**

参考回答：严格说是长上下文（滑窗历史）+ 任务状态（行程草案），不是真正的 Memory。区别在于：真正的 Memory 会把"小王喜欢徒步"抽取成结构化用户画像，跨会话、跨任务地检索和使用；我的实现里这个信息只是躺在历史消息里，删了就没了。面试官问这个问题时，能主动承认边界并说出下一步（偏好抽取 + 向量检索）是加分的。

**Q3：会话状态里存了用户隐私（名字、行程），有什么安全隐患？**

参考回答：当前 JSON 文件明文存储，任何人拿到服务器文件系统就能读。生产级要考虑：敏感字段加密、访问控制（鉴权后 sessionId 才有效）、过期清理（避免数据无限留存）、合规（用户删除权）。另外 sessionId 本身是可猜测/可枚举风险——我用的是 UUID，但若被人拿到 ID 就能冒充会话，所以生产必须有服务端会话绑定（cookie + 签名）。

---

## 16. 毕业检查

### 代码

- [x] StateManager：内存 Map + JSON 持久化 + 滑窗裁剪
- [x] chat 多轮记忆（历史注入 + 成功写回）
- [x] 行程草案状态（recommend 存，chat 引用）
- [x] sessionId 前后端完整链路（localStorage ↔ done 事件）
- [x] 6 个状态测试（含重启恢复），全量 29/29
- [x] 真实五步验证链：新建会话/记忆/草案引用/重启恢复全部通过
- [x] 没有实现下一阶段内容（无向量检索、无数据库）

### 理解

- [ ] 我能用一句话区分 State 和 Memory，并给出本项目中的例子
- [ ] 我能画出 sessionId 从前端到后端再回来的完整链路
- [ ] 我能解释滑窗裁剪的必要性和它的局限
- [ ] 我能回答"为什么不用 Redis/数据库"
- [ ] 我能回答"面试问题"章节的全部问题

### 用户确认

```text
User Confirmation: PENDING
```

---

## 17. 本阶段总结

### 我学会了

- State vs Memory 的概念边界与项目中的落地形态
- 会话状态管理三板斧：内存 Map + JSON 持久化 + 滑窗裁剪
- sessionId 端到端链路设计与断链排查方法
- 行程草案的"存-取-注入"完整模式
- 服务重启不丢状态（有真实验证）

### 我还不会

- 语义检索——"换一种说法就搜不到"（Phase 05）
- 用户画像式的长期记忆（面试后再做）

### 下一阶段

```text
Phase 05 — RAG-lite
```
