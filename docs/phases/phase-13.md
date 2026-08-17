# Phase 13 — 上游调用可靠性

## 1. 本阶段目标

为 LLM 与 embedding 的上游 API 调用增加明确超时、一次有限重试和统一错误分级；当服务仍不可用时，HTTP 与 SSE 都向前端返回可识别、可恢复的错误信息。

## 2. 问题与方案

此前 LLM 只有 SDK timeout，embedding 没有显式 timeout；失败时错误格式也不统一。现在的调用链为：

```text
LLM（60 秒）/ embedding（15 秒）
  → 瞬时网络错误、429、5xx：等待 200ms 后重试一次
  → 仍失败：UpstreamServiceError（503 / *_UNAVAILABLE / retryable=true）
  → HTTP JSON 或 SSE error 事件
```

400 等确定性请求错误不会重试，避免无意义消耗。

## 3. 文件变化

```text
src/utils/retry.js                     # 有限重试、瞬时错误判断、上游错误类
src/services/travelService.js          # agent / planner / executor / chat 统一走 LLM 包装器
src/services/embeddingIndex.js         # 索引构建与查询的 15 秒 timeout + 重试
src/utils/streamUtils.js               # SSE error 带 code / retryable
src/routes/travel.js、src/index.js     # 传递结构化错误
src/__tests__/retry.test.js             # 3 个确定性测试
```

## 4. 关键代码

```js
// src/utils/retry.js
export async function withRetry(operation, { maxAttempts = 2, delayMs = 200 } = {}) {
    // 只对 timeout、网络错误、429、5xx 再执行一次
}
```

```js
// src/services/travelService.js
async callUpstream(operation) {
    try {
        return await withRetry(operation)
    } catch (error) {
        throw new UpstreamServiceError('LLM', error)
    }
}
```

`UpstreamServiceError` 的契约是 `status=503`、`code=LLM_UNAVAILABLE`、`retryable=true`。前端现有规划错误卡片会保留“重新规划”入口；SSE 客户端也可据此扩展更细的恢复提示。

## 5. 测试

命令：

```bash
cd travel-recomend-backend
node --test src/__tests__/retry.test.js src/__tests__/embeddingIndex.test.js src/__tests__/agentLoop.test.js src/__tests__/recommendStream.test.js
```

真实输出：

```text
✔ src/__tests__/agentLoop.test.js
✔ src/__tests__/embeddingIndex.test.js
✔ src/__tests__/recommendStream.test.js
✔ src/__tests__/retry.test.js
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

覆盖：瞬时超时重试后成功、400 不重试、上游 503 契约、embedding 原有索引行为、Agent 图及 SSE 规划回归。

## 6. 本阶段结论

重试不是无限循环：每次上游操作只有“首次 + 一次重试”，而且只对可能恢复的故障执行。用户无法从单次失败中恢复时，系统会返回明确的可重试错误，而不是把网络异常伪装成行程生成失败。

下一阶段再做评测报告增强；本阶段不涉及 Docker、数据库和鉴权。
