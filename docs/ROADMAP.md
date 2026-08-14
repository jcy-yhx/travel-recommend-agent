# ROADMAP — Agent 学习路线总图

> 本文件是学习路线的唯一权威。任何 Phase 的增删改都必须先改这里。
> 学习原则：一次只做一个 Phase；每个 Phase = 代码变化 + 测试 + 学习文档 + 用户掌握确认。

## 主线顺序与理由

Structured Output → Tool Calling → Agent Loop → State → RAG → Planning → LangGraph

- Structured Output 在 Tool 之前：它是工具参数与结果处理的地基，同时消灭当前正则提取 JSON 的脆弱性
- Tool Calling + Agent Loop 共同构成 Agent 的定义
- State 在 Loop 之后：多轮状态依赖循环先存在
- RAG 在核心循环之后：Agent 先成立，再补知识
- Planning 在 RAG 之后：有外部信息可查，规划才有意义
- LangGraph 最后：先手写再框架，学习才真实

## 阶段总表

| Phase | 主题 | 为什么存在 | 毕业标准 | 面试价值 | 时间 | 归属 |
|---|---|---|---|---|---|---|
| 00 | 项目理解与跑通 | 底座不稳一切免谈 | 前后端可构建运行；崩溃 bug 已修复；能画出数据流 | 中 | 1-2 天 | MVP |
| 01 | Structured Output | 消灭正则 JSON + 必问题 | schema 校验 + 失败重试 ≤2；能讲清 JSON mode vs tool forcing | 高 | 2-3 天 | MVP |
| 02 | Tool Calling | Agent 定义的一半 | ≥2 个工具（天气 Mock + 景点查询）；失败处理 | 高 | 2-3 天 | MVP |
| 03 | Agent Loop | 项目成为 Agent 的时刻 | 手写 loop；max_iter 终止；口述循环与终止条件 | 极高 | 2-3 天 | MVP |
| 04 | State / Memory | 多轮规划的基础 | 内存 state + JSON 文件持久化；能区分 State 与 Memory | 高 | 1-2 天 | MVP |
| 05 | RAG-lite | 知识来源外置 | 本地 JSON 知识库 + embedding 检索（不上向量库） | 中高 | 2 天 | 完整 |
| 06 | Planning / Reflection | 复杂任务规划 + 校验 | plan-then-execute + 预算一致性 validator + 一次 re-plan | 高 | 2 天 | 完整 |
| 07 | LangGraph | 工程化重写 loop | 用 LangGraph 重写 Phase 03 的 loop；能回答"为什么不用手写 loop" | 中高（易被问穿） | 1-2 天 | 完整 |
| 08 | Eval & Hardening | 可测试可解释 | eval 集 ≥15 用例 + rubric；错误处理/成本/日志 | 极高 | 2-3 天 | 完整 |
| 09 | Interview Prep | 交付形态 | README + 30s/3min 讲稿 + 2 次模拟面试 | 极高 | 1-2 天 | 完整 |

> Phase 08 由原"Production / Interview"拆分而来（原范围过大）；phase-09.md 待创建。

## Eval 用例积累规则

从 Phase 01 起，每个 Phase 追加 ≥3 个 eval 用例，Phase 08 汇总成型。

## 克制原则（防止过度 Agent 化）

加任何新技术前，必须先回答"如果不用它，会怎样"。答不出来就不加。

- **应该做**：LLM 调用 → Structured Output → Tool Calling → Agent Loop → State（内存 + JSON 文件）→ 小型 Eval 集 → 预算一致性 Validator
- **克制**：RAG 用本地 JSON + embedding，不上向量库；Memory 用 JSON 文件，不上 Redis/向量记忆；LangGraph 仅在能答出"checkpoint 解决什么具体问题"时做
- **面试前不碰**：Multi-Agent、MCP、向量数据库、Fine-tuning、AutoGen/CrewAI、LangSmith、容器化部署

## 最快面试 MVP

Phase 00 → 01 → 02 → 03 → 04，加：
- 每个 Phase 追加 3 个 eval 用例
- Phase 03 起每两周一次模拟面试

## 完整路线

MVP → Phase 05 → 06 → 07 → 08 → 09。
