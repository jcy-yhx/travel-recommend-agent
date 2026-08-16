// Agent 执行轨迹的事件整形层（Phase 10）。
// 把 LangGraph stream() 的 updates 模式增量（{节点名: 状态增量}）转成
// 前端友好的轨迹事件。纯函数、无 LLM、无副作用——可直接单测。

const PREVIEW_LIMIT = 200

function truncate(text, limit = PREVIEW_LIMIT) {
    const str = String(text ?? '')
    return str.length > limit ? str.slice(0, limit) + '…' : str
}

// 把单个节点的增量整形为轨迹事件；不需要展示的节点返回 null
export function shapeNodeEvent(nodeName, update, seq) {
    switch (nodeName) {
        case 'agent': {
            const last = (update.messages ?? [])[update.messages?.length - 1]
            const toolCalls = last?.tool_calls ?? []
            return {
                type: 'node',
                seq,
                node: 'agent',
                data: {
                    iteration: update.agentIterations,
                    stopped: toolCalls.length === 0,
                    toolCalls: toolCalls.map(tc => ({ name: tc.name, args: tc.args ?? {} }))
                }
            }
        }
        case 'tools': {
            // ToolMessage 的 content 是工具返回的 JSON 字符串；
            // 预览在服务端截断——移动端不收全量（可能数 KB）
            const results = (update.messages ?? []).map(message => {
                let parsed = null
                try { parsed = JSON.parse(message.content) } catch { /* 非 JSON 内容 */ }
                return {
                    preview: truncate(message.content),
                    hasError: typeof parsed?.error === 'string'
                }
            })
            return { type: 'node', seq, node: 'tools', data: { results } }
        }
        case 'planner':
            return {
                type: 'node',
                seq,
                node: 'planner',
                data: { ok: Boolean(update.outline), degraded: !update.outline }
            }
        case 'executor':
            return { type: 'node', seq, node: 'executor', data: { planReady: Boolean(update.plan) } }
        case 'validator':
            return {
                type: 'node',
                seq,
                node: 'validator',
                data: { valid: !update.validationErrors, errors: update.validationErrors ?? [] }
            }
        case 'replan_feedback':
            return {
                type: 'node',
                seq,
                node: 'replan_feedback',
                data: { errors: update.validationErrors ?? [] }
            }
        default:
            // fail_max_iter / fail_validation 节点会抛错，不会产生 update；
            // 未知节点（未来扩展）静默忽略
            return null
    }
}
