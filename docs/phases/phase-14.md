# Phase 14 — Agent 过程评测指标

## 目标

扩展端到端评测报告：除“是否生成有效行程、judge 分数”外，同时记录 Agent 的工具调用、耗时、Token 和成本，形成可用于面试展示的质量与效率证据。

## 改动

`travel-recomend-backend/scripts/run-eval.js` 现在从 LangGraph 最终状态读取 `weatherCalls` 与 `attractionSearches`，并输出：

- 每用例天气/景点检索次数及是否满足硬预算；
- 每用例耗时、输入/输出 Token、估算成本；
- 批次平均耗时、总成本、工具预算遵守率。

```text
图执行结果
  → plan + messages + weatherCalls + attractionSearches
  → 规则分 / LLM-as-judge / 成本与工具指标
  → docs/eval/latest-batch-*.md
```

## 为什么重要

只报告“6/6 成功”不足以判断 Agent 是否可控。现在可以回答：成功是否伴随过度检索、每个请求需要多久、消耗多少 Token、工具硬约束是否真的被执行。

## 验证

```bash
cd travel-recomend-backend
node --check scripts/run-eval.js
node --test src/__tests__/toolBudget.test.js src/__tests__/agentLoop.test.js src/__tests__/retry.test.js
```

真实输出：

```text
✔ src/__tests__/agentLoop.test.js
✔ src/__tests__/retry.test.js
✔ src/__tests__/toolBudget.test.js
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

本阶段未运行 `npm run eval:e2e`：它会真实调用 LLM/embedding 并消耗 API 配额，且当前执行环境禁止外网。上线环境运行后，新报告会自动包含新增指标。

## 面试表述

“我把 Agent 的评估拆成结果质量和过程效率两部分：前者是规则校验与 LLM-as-judge，后者是工具预算、延迟、Token 和成本。每次模型或 prompt 变更，都可以用同一套用例比较是否以更高成本换来了更好结果。”
