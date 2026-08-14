import { ToolMessage } from '@langchain/core/messages'
import { getWeather } from './weather.js'
import { searchAttractions } from './attractions.js'

// 提供给模型的白名单工具集（Phase 08 的 guardrails 会讨论"为什么必须白名单"）
export const TOOLS = [getWeather, searchAttractions]

const TOOL_MAP = {
    get_weather: getWeather,
    search_attractions: searchAttractions
}

// 执行模型发起的工具调用，返回 ToolMessage（带 tool_call_id，回传给模型）。
// 两种失败都被转成"带 error 的 ToolMessage"而不是抛异常：
// 1. 未知工具名——模型幻觉出了不存在的工具
// 2. 工具执行抛错——工具内部出问题
// 让模型自己读到失败信息并调整策略，而不是让异常打断整个请求。
export async function executeToolCall(toolCall) {
    const tool = TOOL_MAP[toolCall.name]
    if (!tool) {
        return new ToolMessage({
            content: JSON.stringify({ error: `未知工具：${toolCall.name}` }),
            tool_call_id: toolCall.id
        })
    }
    try {
        const result = await tool.invoke(toolCall.args)
        return new ToolMessage({
            content: JSON.stringify(result),
            tool_call_id: toolCall.id
        })
    } catch (error) {
        console.error(`工具 ${toolCall.name} 执行失败：`, error)
        return new ToolMessage({
            content: JSON.stringify({ error: `工具执行失败：${error.message}` }),
            tool_call_id: toolCall.id
        })
    }
}
