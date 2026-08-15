# Interview Questions — 高频题库

> 使用说明：每道题在对应 Phase 文档 §15 都有参考回答。先自己答，再看文档。
> ⭐ = 高频必考；🔥 = 结合本项目真实故事的高分题。

---

## 一、项目总览

- ⭐ 一句话介绍你的项目（30 秒版本，见 project-introduction.md）
- ⭐ 你的项目是 Agent 吗？为什么？（Phase 03 §15 Q1）
- 🔥 为什么说它"从 LLM Wrapper 演进来"？每个 Phase 解决了什么？（README 演进表）

## 二、Agent 核心机制

- ⭐ Agent 和 LLM Application 的区别（Phase 03）
- ⭐ Agent Loop 的终止条件怎么设计？max_iter 为什么是 5？（Phase 03）
- ⭐ 模型无限调用工具怎么办？（Phase 03：四层防护）
- ⭐ Function Calling 里模型和代码各自做什么？（Phase 02）
- ⭐ tool_choice 有哪几种？你的 required/auto 分层为什么？（Phase 02）
- 🔥 为什么第一轮强制工具调用？——auto 模式实测偷懒的故事（Phase 02 §12）
- 工具调用失败怎么处理？（Phase 02：异常流变数据流）
- 为什么用白名单工具集？（Phase 02）

## 三、结构化输出与校验

- ⭐ Structured Output 是什么？JSON mode 和 prompt 要求有什么区别？（Phase 01）
- ⭐ 校验有哪几层？各管什么？（Phase 06：格式/语义/现实三层）
- 🔥 json_object 与 tool_choice 冲突的排查故事（Phase 02 §12 踩坑 2）
- 🔥 150 元案例：规则校验为什么放行了住宿 0 元的行程？（Phase 06）
- Reflection 和普通重试有什么区别？（Phase 06）
- re-plan 为什么只做一次？（Phase 06）

## 四、状态与记忆

- ⭐ State 和 Memory 的区别（Phase 04：概念表 + 本项目两个真实实现）
- ⭐ 你的 State 存哪？为什么不上 Redis？（Phase 04）
- 多用户并发怎么隔离？（Phase 04：sessionId 链路）
- 对话历史越来越长怎么办？（Phase 04：滑窗裁剪）
- 图状态（LangGraph）和会话状态什么关系？（Phase 07）

## 五、RAG

- ⭐ RAG 是什么？你的项目里五环节各是什么？（Phase 05 映射表）
- ⭐ 为什么不上向量数据库？（Phase 05：克制的答案）
- 相似度阈值怎么定的？（Phase 05：实测校准）
- 语义检索的短板？混合检索是什么？（Phase 05 深挖）
- embedding 服务挂了怎么办？（Phase 05：关键词兜底）

## 六、框架与工程

- ⭐ 为什么用 LangChain？你只用了 ChatOpenAI 和消息类（Phase 01/07）
- ⭐ 为什么用 LangGraph？手写循环不够吗？（Phase 07）
- ⭐ Node/Edge/State 是什么？（Phase 07）
- checkpointing 是什么？你启用了吗？（Phase 07：概念 + 克制理由）
- 什么时候不该用框架？（Phase 07：chat 没图化的理由）

## 七、评估与成本

- ⭐ 如何评估一个 Agent？（Phase 08：三层体系）
- 🔥 你的 eval 发现过什么问题？怎么修的？（Phase 08：迭代故事）
- ⭐ LLM-as-judge 怎么做才可靠？有什么偏差？（Phase 08）
- 如何控制 token 和成本？（Phase 08：观测→四层优化）
- 如何测试 Agent？（Phase 03 踩坑 3：stub 固定决策序列）

## 八、工程与安全

- ⭐ Express 4 里 async 路由抛异常会怎样？（Phase 00：崩溃实录 + asyncHandler）
- SSE 和普通 HTTP 的区别？断线怎么办？（Phase 00）
- 限流怎么设计？单机内存的局限？（Phase 08）
- 工具调用有哪些安全风险？（Phase 02：白名单 + Phase 08：限流/审计）
- prompt 注入怎么防？（Phase 08 概念：guardrails）

## 项目深挖（面试官最爱追问）

1. 如果天气 API 挂了怎么办？→ 工具失败降级（Phase 02）
2. 如果 Agent 无限调用 Tool 怎么办？→ 四层防护（Phase 03）
3. 如果预算超过怎么办？→ validator + re-plan（Phase 06）
4. 如何评估 Agent 是否真的规划得更好？→ 三层 eval + 对照（Phase 08）
5. 如何控制 Token 和成本？→ 观测 + 四层（Phase 08）
6. 如何防止模型调用危险工具？→ 白名单 + 只读工具（Phase 02/08）
7. 如何记录 Agent 的执行轨迹？→ [Graph/*] 日志 + 消息历史（Phase 07）
8. 服务重启用户行程会丢吗？→ 不会，JSON 持久化实测（Phase 04）
9. 为什么不做 Multi-Agent？→ 克制清单（Phase 08）
10. 如果知识库从 22 条涨到 10 万条怎么办？→ 向量库 + 混合检索（Phase 05）

## 模拟面试安排

- **第 1 轮（基础关）**：30s 介绍 + Agent 机制 5 题——考察"能不能讲清楚"
- **第 2 轮（深挖关）**：根据你的回答追击 5-8 题——考察"是不是真的懂"
- 通过标准：所有问题不看文档作答，追问不崩
