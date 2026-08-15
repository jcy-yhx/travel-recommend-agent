// Token 用量统计（成本控制的第一步是"看得见用量"）。
// 非流式调用的 AIMessage 自带 usage_metadata（LangChain 自动附带），
// 遍历消息历史即可汇总本次请求的完整 token 消耗。

// 汇总消息数组里所有 LLM 回复的 token 用量。
// usage 位置兼容两种结构：usage_metadata（新）与 response_metadata.tokenUsage（旧）
export function sumMessagesUsage(messages) {
    const usage = { inputTokens: 0, outputTokens: 0 }
    for (const message of messages ?? []) {
        const u = message?.usage_metadata
            ?? message?.response_metadata?.tokenUsage
            ?? message?.response_metadata?.usage
        if (!u) continue
        usage.inputTokens += u.input_tokens ?? u.prompt_tokens ?? 0
        usage.outputTokens += u.output_tokens ?? u.completion_tokens ?? 0
    }
    return usage
}

// 估算成本（按 token 单价）。价格常变，这里只做量级估算；
// 单价应从环境变量/配置中心读取，生产环境用账单数据为准。
export function estimateCost(usage, { inputPricePerM, outputPricePerM } = {}) {
    const inputPrice = inputPricePerM ?? 0.3   // 元/百万 token（占位，按实际模型调整）
    const outputPrice = outputPricePerM ?? 1.2
    return (usage.inputTokens / 1e6) * inputPrice + (usage.outputTokens / 1e6) * outputPrice
}
