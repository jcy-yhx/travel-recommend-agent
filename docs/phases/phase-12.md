# Phase 12 — 程序级工具预算控制

## 1. 本阶段目标

将 prompt 中“天气查询 1 次、景点检索最多 2 次”的软约束升级为 LangGraph 图状态中的硬约束，避免模型反复调用工具，导致长天数行程在尚未生成方案前触发 `max_iter`。

## 2. 为什么做这个

此前 `TOOL_PROTOCOL` 虽然写明了工具次数上限，但它只是发给模型的文字。模型仍可能反复请求 `get_weather` 或 `search_attractions`；图只会在第 5 轮报错：

```text
Agent 达到最大迭代次数（5 轮）仍未停止工具调用
```

因此，“10 天行程失败”不是天数超过限制，而是模型在生成行程前耗尽了工具循环次数。生产化的控制条件不能只放在 prompt 中，必须由编排层强制执行。

## 3. 本阶段架构

```text
agent 请求工具
  ↓
partitionToolCalls（根据图状态计算剩余额度）
  ├─ 有额度的调用 → tools 执行 → 更新计数 → agent
  └─ 已知工具额度已耗尽 → planner（强制结束工具循环）
                                      ↓
                             executor → validator

未知工具 → 保持原有错误 ToolMessage → 仍受 max_iter 兜底
```

额度固定为：`get_weather` 最多 1 次，`search_attractions` 最多 2 次。它们与旅行天数无关。

## 4. 文件变化

```text
travel-recomend-backend/src/graphs/travelAgentGraph.js
  - 图状态新增 weatherCalls / attractionSearches
  - 新增 partitionToolCalls 纯函数
  - routeAfterAgent 在额度耗尽时强制转 planner
  - tools 节点只执行额度内调用，并写回计数

travel-recomend-backend/src/__tests__/toolBudget.test.js
  - 新增 3 个额度切分单测

travel-recomend-backend/src/__tests__/agentLoop.test.js
  - 新增“重复天气请求不会触发 max_iter”回归测试

travel-recomend-backend/src/__tests__/recommendStream.test.js
travel-recomend-backend/src/__tests__/refine.test.js
  - max_iter 场景改为未知工具循环，保留全局兜底覆盖
```

## 5. 关键代码

### 5.1 将调用额度保存为图状态

```js
// travel-recomend-backend/src/graphs/travelAgentGraph.js:60
weatherCalls: Annotation({ default: () => 0 }),
attractionSearches: Annotation({ default: () => 0 }),
```

图状态会随 `agent → tools → agent` 循环传递；这与 prompt 不同，不会依赖模型是否记住规则。

### 5.2 切分“可执行”与“跳过”的调用

```js
// travel-recomend-backend/src/graphs/travelAgentGraph.js:24
export function partitionToolCalls(toolCalls = [], { weatherCalls = 0, attractionSearches = 0 } = {}) {
    // get_weather 只允许 1 次；search_attractions 只允许 2 次
    // 返回 executable / skipped，以及执行后应写回的计数
}
```

同一条模型消息里即使一次请求多个工具，也会按剩余额度逐个切分，不能绕过限制。

### 5.3 额度耗尽后强制规划

```js
// travel-recomend-backend/src/graphs/travelAgentGraph.js:96
const { executable } = partitionToolCalls(last.tool_calls, state)
if (executable.length > 0) return 'tools'
logger.info('[Graph/agent] 工具预算已耗尽，强制进入行程规划')
return 'planner'
```

这条条件边才是本阶段的核心：已知工具都没有余额时，模型即便仍请求工具，也不能再把流程带回 `tools`，而是转入大纲和完整行程生成。

## 6. 验收标准

- `get_weather` 在一次图执行中最多实际执行 1 次。
- `search_attractions` 在一次图执行中最多实际执行 2 次。
- 重复请求已耗尽的已知工具时，流程进入 `planner`，不因它触发 `max_iter`。
- 未知工具仍返回原有错误信息；持续请求未知工具仍由 5 轮 `max_iter` 保护。

## 7. 测试

### 7.1 Phase 12 相关测试

命令：

```bash
cd travel-recomend-backend
node --test src/__tests__/agentLoop.test.js src/__tests__/toolBudget.test.js src/__tests__/recommendStream.test.js src/__tests__/refine.test.js
```

真实输出：

```text
✔ src/__tests__/agentLoop.test.js
✔ src/__tests__/recommendStream.test.js
✔ src/__tests__/refine.test.js
✔ src/__tests__/toolBudget.test.js
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

### 7.2 核心回归测试

命令：

```bash
node --test src/__tests__/agentLoop.test.js src/__tests__/embeddingIndex.test.js src/__tests__/hardening.test.js src/__tests__/planValidator.test.js src/__tests__/recommendStream.test.js src/__tests__/refine.test.js src/__tests__/reflection.test.js src/__tests__/stateManager.test.js src/__tests__/structuredOutput.test.js src/__tests__/toolBudget.test.js src/__tests__/traceEvents.test.js src/__tests__/usageStats.test.js
```

真实输出：

```text
✔ src/__tests__/agentLoop.test.js
✔ src/__tests__/embeddingIndex.test.js
✔ src/__tests__/hardening.test.js
✔ src/__tests__/planValidator.test.js
✔ src/__tests__/recommendStream.test.js
✔ src/__tests__/refine.test.js
✔ src/__tests__/reflection.test.js
✔ src/__tests__/stateManager.test.js
✔ src/__tests__/structuredOutput.test.js
✔ src/__tests__/toolBudget.test.js
✔ src/__tests__/traceEvents.test.js
✔ src/__tests__/usageStats.test.js
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

说明：`tools.test.js` 会真实请求 embedding 服务，`smoke.test.js` 与 `sessionApi.test.js` 会监听本地端口；当前受限执行环境不允许网络访问或监听端口，故本阶段未在该环境运行这三个文件。它们不在本次改动路径内。

## 8. 本阶段结论

工具使用策略现在有两层保护：prompt 负责告诉模型“应该如何做”，LangGraph 状态和条件边负责保证“最多能做多少次”。这样多天行程会在收集有限资料后进入规划，而不是被重复检索卡死。

下一阶段才处理超时、重试、错误分级与前端可恢复体验；本阶段不提前实现。
