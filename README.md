# AI Travel Agent — 智能旅游规划 Agent

一个从零演进为完整 Agent 的旅游规划系统：Vue3 移动端 + Express + LLM + Tool Calling + RAG + LangGraph，9 个 Phase 逐步构建，每个 Phase 都有测试和评估数据支撑。

## 项目亮点（全部有真实数据）

- **手写 Agent Loop → LangGraph 图**：8 节点图（agent↔tools 循环 + planner→executor→validator + re-plan 条件边），重写时 **Phase 03-06 的 48 个测试一个没改、原样通过**——行为等价性是重写正确性的证明
- **三层评估体系**：53 个确定性单测 + 检索 eval（语义检索 8/8 vs 关键词 1/8）+ 端到端 eval（6/6 通过，LLM-as-judge 均分 4.33/5）。**第一轮 eval 抓到 2 个真实缺陷并完成修复迭代**
- **Structured Output 三层防线**：JSON mode + zod schema + 带反馈重试（实测 json_object 与 tool_choice 在同一实例冲突，用双实例架构解决）
- **RAG-lite**：bge-m3 语义检索 + 内容感知缓存 + 阈值 0.48（真实数据校准），刻意不上向量库（22 条数据暴力扫描毫秒级）
- **状态管理**：会话级多轮记忆 + 行程草案 + JSON 持久化（服务重启不丢，实测验证）
- **工程收口**：asyncHandler + 全局错误中间件（修复过真实崩溃）、SSE 流式、限流、token 成本观测、分级日志

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + TypeScript + Vant 4（移动端 SPA）+ SSE 流式 |
| 后端 | Node.js + Express 4 |
| LLM | SiliconFlow API（DeepSeek V4 Flash，OpenAI 兼容） |
| 编排 | LangChain（ChatOpenAI / tool()）+ **LangGraph**（StateGraph） |
| 校验 | zod（格式层）+ 自研规则校验器（语义层）+ LLM-as-judge（现实层） |
| 检索 | bge-m3 embedding + 余弦相似度（本地 JSON 索引，无向量库） |
| 测试 | node:test（stub 固定决策序列）+ 自研 eval 脚本 |

## 架构

```text
User（Vue3 移动端）
  │  POST /api/travel/recommend / chat（SSE）
  ▼
Express 路由 ── 参数校验 · 限流 · asyncHandler · 全局错误中间件
  ▼
LangGraph 图（8 节点）
  ├─ agent ↔ tools（循环：required 首轮 + auto 决策 + max_iter 兜底）
  ├─ planner → executor（plan-then-execute，大纲可降级）
  ├─ validator（5 条规则）→ re-plan 一次 → 仍失败 500
  └─ 状态：messages / 大纲 / 行程 / 迭代计数（Annotation.Root）
  ▼
行程 → zod 校验 → 返回前端 + 写入会话状态（StateManager，JSON 持久化）
  ▲
Eval：53 单测 / 检索 8 用例 / 端到端 6 用例（规则分 + LLM-judge）
```

## 从 LLM Wrapper 到 Agent 的演进（9 个 Phase）

| Phase | 主题 | 解决的真实问题 | 验证 |
|---|---|---|---|
| 00 | 项目跑通 | 修复非法请求杀死进程、前端构建失败 | 冒烟 5/5 |
| 01 | Structured Output | 正则提取 JSON 的脆弱性 → JSON mode + zod + 重试 | 单测 12/12 |
| 02 | Tool Calling | 行程数据来自参数记忆 → 天气/景点工具 + 强制 grounding | 单测 20/20 |
| 03 | Agent Loop | 单轮工具调用 → 多轮自主循环 + 双终止条件 | 单测 23/23 |
| 04 | State/Memory | 每句话都失忆 → 会话多轮记忆 + 重启持久化 | 单测 29/29 |
| 05 | RAG-lite | "换一种说法就搜不到" → embedding 语义检索 | eval 8/8 |
| 06 | Planning/Reflection | 预算超标无人管 → 大纲先行 + 校验 + 一次 re-plan | 单测 48/48 |
| 07 | LangGraph | 手写编排不可视 → 8 节点图（旧测试原样通过） | 单测 48/48 |
| 08 | Eval & Hardening | 不知道 Agent 有多好 → 三层评估 + 成本观测 | 53/53 + e2e 6/6 |
| 09 | Interview Prep | —— | 本文件 |

## 快速开始

### Docker 一键启动（推荐）

```bash
docker compose up --build
```

打开 `http://localhost:5173`，先注册账号再使用。首次启动会自动创建 PostgreSQL 表；会话数据保存在 Docker 命名卷中。

生产部署前请设置强随机密钥：`JWT_SECRET=你的随机密钥 docker compose up -d --build`。

```bash
# 后端
cd travel-recomend-backend
cp .env.example .env    # 填入 SILICONFLOW_API_KEY
npm install
npm run dev             # http://127.0.0.1:3300

# 前端
cd travel-recomend-front
npm install
npm run dev             # http://127.0.0.1:5173（已配置 /api 代理）
```

## 测试与评估

```bash
npm test               # 53 个确定性单测（零 API 成本）
npm run eval:retrieval # 检索质量：语义 8/8 vs 关键词 1/8
npm run eval:e2e 0 3   # 端到端评估（真实 API，分批运行）
```

评估报告见 `docs/eval/`；完整学习文档见 `docs/phases/`（每个 Phase 一个文档，含真实踩坑记录与面试问答）。

## 已知局限（诚实声明）

- 天气工具是 Mock 数据；景点知识库 22 条（三亚等城市覆盖薄）
- 会话状态单机 JSON 文件，无鉴权体系
- chat 流式的 token 统计受 SDK 限制未实现
- 未启用 LangGraph checkpointing（无断点恢复需求）
