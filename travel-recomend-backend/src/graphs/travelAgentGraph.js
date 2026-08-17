import { Annotation, StateGraph, START, END, messagesStateReducer } from '@langchain/langgraph'
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import { TOOLS, executeToolCall } from '../tools/index.js'
import { validatePlan } from '../services/planValidator.js'
import { logger } from '../utils/logger.js'

// LangGraph 的 messagesStateReducer 要求增量消息是真正的 BaseMessage。
// 真实 LLM 返回 AIMessage 没问题；测试 stub 常返回普通 {content} 对象，
// 这里统一包装，让节点出口的消息一定是合法消息类型。
function toMessage(value) {
    if (value && typeof value.getType === 'function') return value
    return new AIMessage({ content: value?.content ?? '' })
}

// Agent Loop 的最大迭代轮数（从 travelService 移到这里——循环的控制权属于图）
export const MAX_AGENT_ITERATIONS = 5
// 工具预算是程序级硬限制，不依赖模型是否遵守 prompt。
export const MAX_WEATHER_CALLS = 1
export const MAX_ATTRACTION_SEARCHES = 2

// 从模型请求中挑出仍在预算内的调用，并计算执行后的计数。
// 未知工具不占已知工具预算，仍交给 executeToolCall 返回错误信息；
// 若模型持续请求未知工具，MAX_AGENT_ITERATIONS 仍是最终兜底。
export function partitionToolCalls(toolCalls = [], { weatherCalls = 0, attractionSearches = 0 } = {}) {
    let nextWeatherCalls = weatherCalls
    let nextAttractionSearches = attractionSearches
    const executable = []
    const skipped = []

    for (const toolCall of toolCalls) {
        if (toolCall.name === 'get_weather') {
            if (nextWeatherCalls >= MAX_WEATHER_CALLS) {
                skipped.push(toolCall)
            } else {
                executable.push(toolCall)
                nextWeatherCalls++
            }
        } else if (toolCall.name === 'search_attractions') {
            if (nextAttractionSearches >= MAX_ATTRACTION_SEARCHES) {
                skipped.push(toolCall)
            } else {
                executable.push(toolCall)
                nextAttractionSearches++
            }
        } else {
            executable.push(toolCall)
        }
    }

    return { executable, skipped, weatherCalls: nextWeatherCalls, attractionSearches: nextAttractionSearches }
}

// 图的共享状态（State）：LangGraph 的 State 与 Phase 04 的会话 State 是
// 两个不同层面的概念——这里是"单次图执行内的状态"，跨节点自动流转。
const AgentState = Annotation.Root({
    // messagesStateReducer：节点只需返回"新增的消息"，图自动追加到历史
    messages: Annotation({ reducer: messagesStateReducer, default: () => [] }),
    // 用户约束（预算/天数）
    constraints: Annotation({ default: () => ({ budget: 0, days: 1 }) }),
    // Agent 循环轮数（agent 节点每次 +1，用于 max_iter 兜底）
    agentIterations: Annotation({ default: () => 0 }),
    // 工具调用计数：限制属于图状态，跨 agent/tools 循环持久传递。
    weatherCalls: Annotation({ default: () => 0 }),
    attractionSearches: Annotation({ default: () => 0 }),
    // 行程大纲（planner 产出；为 null 表示降级跳过规划）
    outline: Annotation({ default: () => null }),
    // 最终行程（executor 产出）
    plan: Annotation({ default: () => null }),
    // 语义校验错误（validator 产出；校验通过时置 null 避免陈旧状态）
    validationErrors: Annotation({ default: () => null }),
    // re-plan 次数（只允许一次）
    replanCount: Annotation({ default: () => 0 })
})

// 图工厂：闭包捕获 service，节点在运行时通过 service 访问 LLM 实例
// （测试可以通过替换 service.xxx 注入 stub——Phase 03/06 的测试全部原样可用）
export function createTravelAgentGraph(service) {

    // ① agent 节点：调用 LLM。第一轮 tool_choice=required 强制 grounding，
    //    后续轮次 auto 让模型自主决策"继续调工具或停止"
    async function agentNode(state) {
        const { messages, agentIterations } = state
        const llm = agentIterations === 0
            ? service.toolLlm.bindTools(TOOLS, { tool_choice: 'required' })
            : service.toolLlm.bindTools(TOOLS)

        const response = await llm.invoke(messages)
        logger.info(`[Graph/agent] 第 ${agentIterations + 1} 轮：${response.tool_calls?.length ?? 0} 次工具调用`,
            response.tool_calls?.map(tc => tc.name).join(', ') || '（模型停止请求工具）')

        return { messages: [toMessage(response)], agentIterations: agentIterations + 1 }
    }

    // agent 之后的路径选择：只执行预算内的已知工具调用。
    // 已知工具预算耗尽后，强制进入 planner，不能让模型反复请求工具烧光迭代。
    function routeAfterAgent(state) {
        const last = state.messages[state.messages.length - 1]
        if (last?.tool_calls?.length) {
            if (state.agentIterations >= MAX_AGENT_ITERATIONS) return 'fail_max_iter'
            const { executable } = partitionToolCalls(last.tool_calls, state)
            if (executable.length > 0) return 'tools'
            logger.info('[Graph/agent] 工具预算已耗尽，强制进入行程规划')
        }
        return 'planner'
    }

    // ② tools 节点：仅执行预算内调用；同一轮多余调用返回 ToolMessage，
    // 让 LLM 知道该调用未实际发生，同时保持 tool_call_id 协议完整。
    async function toolsNode(state) {
        const last = state.messages[state.messages.length - 1]
        const toolMessages = []
        const { executable, skipped, weatherCalls, attractionSearches } = partitionToolCalls(last.tool_calls, state)
        for (const toolCall of executable) {
            const toolMessage = await executeToolCall(toolCall)
            logger.info(`[Graph/tools] ${toolCall.name}(${JSON.stringify(toolCall.args)}) 执行结果：`,
                toolMessage.content.slice(0, 100))
            toolMessages.push(toolMessage)
        }
        for (const toolCall of skipped) {
            toolMessages.push(new ToolMessage({
                content: JSON.stringify({ error: `工具调用额度已用尽：${toolCall.name}` }),
                tool_call_id: toolCall.id
            }))
        }
        return { messages: toolMessages, weatherCalls, attractionSearches }
    }

    // ③ planner 节点：生成行程大纲（失败可降级——Phase 06 的 generateOutline）
    async function plannerNode(state) {
        const { messages, constraints } = state
        const outlinePrompt = new HumanMessage(
            `基于以上工具返回的真实资料，先输出一份行程大纲（不要细节），结构如下：` +
            `{"city":"城市名","days":天数,"totalBudget":总预算,"dailyOutline":[{"day":1,"theme":"当日主题","spots":["景点1","景点2"]}]}。` +
            `要求：总预算不得超过 ${constraints.budget} 元；只输出 JSON 对象本身。`
        )
        const outline = await service.generateOutline([...messages, outlinePrompt])
        if (!outline) {
            logger.warn('[Graph/planner] 大纲生成失败，降级跳过规划')
            return { messages: [outlinePrompt], outline: null }
        }
        logger.info('[Graph/planner] 行程大纲生成成功')
        const outlineMessage = toMessage(outline)
        return { messages: [outlinePrompt, outlineMessage], outline: outlineMessage }
    }

    // ④ executor 节点：按大纲展开完整行程（Phase 01 格式校验 + 重试在
    //    service.validatePlanWithRetries 内部保留）
    async function executorNode(state) {
        const { messages, outline } = state
        const prompt = outline
            ? new HumanMessage(
                '现在把行程大纲展开为完整行程：每天的上午/下午/晚上安排（景点、时长、门票、交通、介绍），' +
                '并给出预算分配明细。预算分配明细的合计必须与总预算一致。只输出 JSON 对象本身。')
            : new HumanMessage(
                '基于收集到的资料，直接生成完整行程 JSON：每天的上午/下午/晚上安排（景点、时长、门票、交通、介绍），' +
                '并给出预算分配明细。预算分配明细的合计必须与总预算一致。只输出 JSON 对象本身。')

        const originalLength = messages.length
        const msgs = [...messages, prompt]
        msgs.push(toMessage(await service.structuredLlm.invoke(msgs)))
        const plan = await service.validatePlanWithRetries(msgs)

        // 返回增量消息（图会自动追加），以及最终行程
        return { messages: msgs.slice(originalLength).map(toMessage), plan }
    }

    // ⑤ validator 节点：语义校验（预算/天数/明细一致性）
    function validatorNode(state) {
        const result = validatePlan(state.constraints, state.plan)
        if (result.valid) {
            logger.info('[Graph/validator] 行程校验通过')
            return { validationErrors: null }
        }
        logger.error('[Graph/validator] 行程校验失败：', result.errors.join('；'))
        return { validationErrors: result.errors }
    }

    // validator 之后的路径选择：通过 → 结束；失败且未 re-plan → 反馈修正；
    // 失败且已 re-plan → 明确失败
    function routeAfterValidator(state) {
        if (!state.validationErrors?.length) return END
        if (state.replanCount >= 1) return 'fail_validation'
        return 'replan_feedback'
    }

    // ⑥ re-plan 反馈节点：把校验错误拼成反馈消息，回流到 executor
    function replanFeedbackNode(state) {
        logger.info('[Graph/replan] 触发 re-plan（1/1）')
        return {
            messages: [new HumanMessage(
                `你生成的行程存在以下问题：${state.validationErrors.join('；')}。` +
                `请修正这些问题后重新输出完整的行程 JSON（结构与之前相同，只输出 JSON 对象本身）。`
            )],
            replanCount: state.replanCount + 1
        }
    }

    // 失败节点：抛出明确错误（由全局错误中间件转成 500）
    function failMaxIterNode() {
        throw new Error(`Agent 达到最大迭代次数（${MAX_AGENT_ITERATIONS} 轮）仍未停止工具调用`)
    }
    function failValidationNode(state) {
        throw new Error(`行程校验失败（re-plan 后仍不通过）：${state.validationErrors.join('；')}`)
    }

    // 组装图：节点 + 边（固定边 + 条件边）
    return new StateGraph(AgentState)
        .addNode('agent', agentNode)
        .addNode('tools', toolsNode)
        .addNode('planner', plannerNode)
        .addNode('executor', executorNode)
        .addNode('validator', validatorNode)
        .addNode('replan_feedback', replanFeedbackNode)
        .addNode('fail_max_iter', failMaxIterNode)
        .addNode('fail_validation', failValidationNode)

        .addEdge(START, 'agent')
        .addConditionalEdges('agent', routeAfterAgent)
        .addEdge('tools', 'agent')                    // 循环：执行完工具回到 agent 再决策
        .addEdge('planner', 'executor')
        .addEdge('executor', 'validator')
        .addConditionalEdges('validator', routeAfterValidator)
        .addEdge('replan_feedback', 'executor')       // 循环：反馈回流重新生成
        .addEdge('fail_max_iter', END)
        .addEdge('fail_validation', END)
        .compile()
}
