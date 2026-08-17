import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'
import { extractJson } from '../utils/extractJson.js'
import { TravelPlanSchema, PlanOutlineSchema, summarizeZodError } from './travelPlanSchema.js'
import { stateManager } from './stateManager.js'
import { createTravelAgentGraph } from '../graphs/travelAgentGraph.js'
import { sumMessagesUsage, estimateCost } from '../utils/tokenStats.js'
import { logger } from '../utils/logger.js'
import { shapeNodeEvent } from '../utils/traceEvents.js'
import { UpstreamServiceError, withRetry } from '../utils/retry.js'

// 结构化输出校验失败后的最大重试次数（不含首次调用）
const MAX_RETRIES = 2

// 工具使用协议（SystemMessage 内容）：recommend 与 refine 共用同一份，
// 避免两份 prompt 里的工具约束漂移（prompt 单一事实来源）
const TOOL_PROTOCOL = `你是专业的旅游规划师。规划前必须先调用工具获取真实资料：
- 调用 get_weather 查询目的地天气（1 次即可）
- 调用 search_attractions 检索目的地景点（最多 2 次）
然后基于工具返回的真实资料生成行程。
硬性约束：search_attractions 调用达到 2 次后，即使信息不完整也必须停止搜索，
基于已有资料和你的知识完成规划，并在相应景点介绍中注明不确定性。
反复搜索同一目的地是禁止的——它会浪费预算且不带来新信息。`

// 行程 JSON 结构模板（prompt 用）：recommend 与 refine 共用同一份，
// 与 travelPlanSchema.js 的 zod schema 对应（一个约束模型、一个约束 prompt）
const SCHEMA_SPEC = `{
"city": "城市名",
"days": 天数,
"totalBudget": 总预算,
"dailyItinerary": [
    {
    "day": 1,
    "date": "第1天",
    "morning": {
        "spot": "景点名称",
        "duration": "游览时长（字符串，如\"约2小时\"）",
        "ticket": "门票价格（字符串，如60元或免费）",
        "transportation": "交通方式",
        "description": "景点介绍"
    },
    "afternoon": {
        "spot": "景点名称",
        "duration": "游览时长（字符串）",
        "ticket": "门票价格（字符串）",
        "transportation": "交通方式",
        "description": "景点介绍"
    },
    "evening": {
        "spot": "活动名称",
        "duration": "活动时长（字符串）",
        "ticket": "费用（字符串）",
        "transportation": "交通方式",
        "description": "活动介绍"
    }
    }
],
"budgetBreakdown": {
    "accommodation": 住宿费用,
    "food": 餐饮费用,
    "transportation": 交通费用,
    "tickets": 门票费用,
    "other": 其他费用
},
"tips": ["提示1", "提示2", "提示3"],
"warnings": ["注意事项1", "注意事项2"]
}`

const SCHEMA_OUTPUT_INSTRUCTION = '重要：只输出 JSON 对象本身，不要输出任何解释性文字，不要用代码围栏包裹。'

class TravelService {
    constructor() {
        this.llm = null
        this.structuredLlm = null
        this.toolLlm = null
        this.initLLM()
        // LangGraph 图：Phase 07 起 recommend 的编排由"手写循环"改为图结构。
        // 节点在运行时通过 this.toolLlm / this.structuredLlm 访问 LLM，
        // 因此测试仍可通过替换这些属性注入 stub。
        this.graph = createTravelAgentGraph(this)
    }

    initLLM() {
        const provider = process.env.MODEL_PROVIDER
        let apiKey,baseURL,model
        if(provider === 'SILICONFLOW') {
            apiKey = process.env.SILICONFLOW_API_KEY
            baseURL = process.env.SILICONFLOW_BASE_URL
            model = process.env.SILICONFLOW_MODEL
        } else{
            throw new Error('不支持的模型提供程序')
        }

        const baseConfig = {
            configuration: {
                baseURL
            },
            apiKey,
            model,
            // 旅游规划一次图执行会连续调用多个上游服务；默认 120 秒，部署时可覆盖。
            timeout: Number(process.env.LLM_TIMEOUT_MS || 120000),
            // 关闭 SDK 隐式重试，统一由 callUpstream 执行一次可观测重试。
            maxRetries: 0,
            // 成本控制：限制单次回复最大 token 数
            maxTokens: 4096
        }

        // 聊天用 LLM：较高温度，回答更自然
        this.llm = new ChatOpenAI({
            ...baseConfig,
            temperature: 0.7,
            streaming:true
        })

        // 结构化输出用 LLM：低温 + JSON mode
        // - 低温（0.2）：降低随机性，更容易稳定复现结构
        // - response_format: json_object：让模型只输出合法 JSON，从源头减少解析失败
        this.structuredLlm = new ChatOpenAI({
            ...baseConfig,
            temperature: 0.2,
            modelKwargs: { response_format: { type: 'json_object' } }
        })

        // 工具调用用 LLM：低温，但不带 JSON mode。
        // 实测：response_format json_object 与 tool_choice required 在同一实例上
        // 会冲突（提供方报错，LangChain 抛"reading 'message'"）。
        // 因此工具调用轮次和最终 JSON 输出轮次各用各的实例。
        this.toolLlm = new ChatOpenAI({
            ...baseConfig,
            temperature: 0.2
        })
    }

    async callUpstream(operation) {
        try {
            return await withRetry(operation, {
                onRetry: (error, attempt) => logger.warn(`[LLM] 第 ${attempt} 次调用失败，200ms 后重试：${error.message}`)
            })
        } catch (error) {
            throw new UpstreamServiceError('LLM', error)
        }
    }

    invokeToolLlm(llm, messages) {
        return this.callUpstream(() => llm.invoke(messages))
    }

    invokeStructuredLlm(messages) {
        return this.callUpstream(() => this.structuredLlm.invoke(messages))
    }

    async recommend(city, budget, days, sessionId = null) {
        // 参数校验已由路由层完成（HTTP 边界返回 400）

        // Phase 07 起：编排交给 LangGraph 图（agent→tools 循环 + planner→
        // executor→validator + re-plan 条件边），service 只负责准备输入和收尾。
        // 初始状态：消息 + 用户约束；图执行完拿 result.plan。
        const result = await this.graph.invoke({
            messages: this.getTravelPrompt(city, budget, days),
            constraints: { budget, days },
            agentIterations: 0,
            replanCount: 0
        })

        const plan = result.plan

        // 成本观测：汇总本次请求全部 LLM 调用的 token 消耗
        const usage = sumMessagesUsage(result.messages)
        logger.info(`[Cost] 本次行程规划 token 消耗：输入 ${usage.inputTokens} + 输出 ${usage.outputTokens}` +
            `，估算成本 ¥${estimateCost(usage).toFixed(4)}`)

        // 行程草案写入会话状态：之后 chat 可以引用"用户刚才规划的行程"
        if (sessionId) {
            await stateManager.setTripPlan(sessionId, plan)
            await stateManager.recordUsage(sessionId, 'recommend', usage)
        }
        return plan
    }

    // 图的流式执行（recommendStream 与 refine 共用）：updates 模式增量 →
    // 轨迹事件；values 模式完整状态 → 结束后的 plan/usage 计算。
    // 节点抛错（fail_max_iter / fail_validation）时 for-await 直接抛出，
    // 由路由层转成 SSE error 事件——与 /chat 的错误模式一致
    async streamGraph(initialState, onEvent) {
        const stream = await this.graph.stream(initialState, { streamMode: ['updates', 'values'] })
        let finalState = null
        let seq = 0

        for await (const [mode, chunk] of stream) {
            if (mode === 'updates') {
                for (const [nodeName, update] of Object.entries(chunk)) {
                    const event = shapeNodeEvent(nodeName, update, seq++)
                    if (event) onEvent(event)
                }
            } else if (mode === 'values') {
                finalState = chunk
            }
        }
        return finalState
    }

    // 流式版 recommend（Phase 10）：用 graph.stream() 的 updates 模式
    // 把每个节点的执行增量实时转发为轨迹事件。
    // 与 recommend() 共用同一个图——graph.invoke 与 graph.stream 只是
    // 同一个执行引擎的两种消费方式（53 个旧测试与 eval 脚本不受影响）。
    async recommendStream(city, budget, days, sessionId = null, onEvent) {
        const finalState = await this.streamGraph({
            messages: this.getTravelPrompt(city, budget, days),
            constraints: { budget, days },
            agentIterations: 0,
            replanCount: 0
        }, onEvent)

        const plan = finalState?.plan
        const usage = sumMessagesUsage(finalState?.messages ?? [])
        const usageWithCost = { ...usage, estimatedCost: estimateCost(usage) }
        logger.info(`[Cost] 本次行程规划 token 消耗：输入 ${usage.inputTokens} + 输出 ${usage.outputTokens}` +
            `，估算成本 ¥${usageWithCost.estimatedCost.toFixed(4)}`)

        if (sessionId) {
            await stateManager.setTripPlan(sessionId, plan)
            await stateManager.recordUsage(sessionId, 'recommend', usage)
        }
        return { plan, usage: usageWithCost }
    }

    // 修改行程（Phase 11）：用户对已有行程提出修改指令，重跑同一个图。
    // 初始消息注入"旧行程 JSON + 修改指令"，走 agent→tools→planner→executor→
    // validator 全链路——修改同样基于真实资料，而不是凭空改文本。
    // 与 Phase 06 validator 触发的 re-plan 对称：一个是规则触发（自动），
    // 一个是用户触发（交互），两者共用同一套图与收口逻辑。
    async refine(sessionId, instruction, onEvent) {
        const session = await stateManager.getSession(sessionId)
        // 只有完整行程才能修改；Phase 11 前的旧会话只有概要 → 明确报错
        // （路由层已先校验返回 400，这里兜底 service 被直接调用的情况）
        if (!session?.tripPlan?.plan) {
            throw new Error('该会话没有可修改的行程（请先规划一次）')
        }
        const oldPlan = session.tripPlan.plan

        const finalState = await this.streamGraph({
            messages: this.getRefinePrompt(oldPlan, instruction),
            // 约束取旧行程：天数不变；预算作为上限（用户可要求压缩预算）
            constraints: { budget: oldPlan.totalBudget, days: oldPlan.days },
            agentIterations: 0,
            replanCount: 0
        }, onEvent)

        const plan = finalState?.plan
        const usage = sumMessagesUsage(finalState?.messages ?? [])
        const usageWithCost = { ...usage, estimatedCost: estimateCost(usage) }
        logger.info(`[Cost] 修改行程 token 消耗：输入 ${usage.inputTokens} + 输出 ${usage.outputTokens}` +
            `，估算成本 ¥${usageWithCost.estimatedCost.toFixed(4)}`)

        // 新行程覆盖旧行程（同一会话只保留最新一份行程）
        await stateManager.setTripPlan(sessionId, plan)
        await stateManager.recordUsage(sessionId, 'refine', usage)
        return { plan, usage: usageWithCost }
    }

    // 生成行程大纲：解析 + 校验，失败带反馈重试一次；仍失败返回 null（降级：跳过规划）
    async generateOutline(messages) {
        for (let attempt = 0; attempt <= 1; attempt++) {
            try {
                const response = await this.invokeStructuredLlm(messages)
                const json = JSON.parse(extractJson(response.content))
                PlanOutlineSchema.parse(json)
                return response
            } catch (error) {
                const reason = summarizeZodError(error) || error.message
                logger.error(`[Planner] 大纲生成失败（第 ${attempt + 1} 次）：${reason}`)
                if (attempt === 0) {
                    messages.push(new HumanMessage(
                        `你上一次输出的大纲无法解析，错误信息：${reason}。请重新输出大纲 JSON。`
                    ))
                }
            }
        }
        logger.warn('[Planner] 大纲连续失败，跳过规划步骤直接生成完整行程（降级）')
        return null
    }

    // 结构化输出循环：校验 messages 中最后一条模型回答；失败则把错误反馈给模型重试
    async validatePlanWithRetries(messages) {
        let lastError = null

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const last = messages[messages.length - 1]
                // extractJson 返回的是字符串，需要 JSON.parse 转成对象再校验
                const json = JSON.parse(extractJson(last.content))
                return TravelPlanSchema.parse(json)
            } catch (error) {
                lastError = error
                const reason = summarizeZodError(error) || error.message
                logger.error(`第 ${attempt + 1} 次结构化输出失败：${reason}`)

                // 带反馈的重试：告诉模型上一次输出错在哪，而不是盲目重发同一请求
                messages.push(new HumanMessage(
                    `你上一次的输出无法解析，错误信息：${reason}。` +
                    `请重新输出，必须严格符合要求的结构，且只输出 JSON 对象本身。`
                ))
                messages.push(await this.invokeStructuredLlm(messages))
            }
        }

        // 重试耗尽仍然失败：抛出异常，由全局错误中间件返回 500
        throw new Error(`模型输出解析失败（已重试 ${MAX_RETRIES} 次）：${summarizeZodError(lastError) || lastError.message}`)
    }

    getTravelPrompt(city, budget, days){
        return [
            // 工具使用协议放在 SystemMessage：角色级指令对 tool calling 的
            // 约束力远强于塞在用户消息里（实测：写在 HumanMessage 里模型经常跳过工具）
            new SystemMessage(TOOL_PROTOCOL),
            new HumanMessage(`请根据以下信息为用户生成一份详细的旅游规划：
            - 目的地城市：${city}
            - 预算：${budget}元
            - 旅行天数：${days}天

            要求：
            1. 每天的行程安排（上午、下午、晚上）
            2. 每个景点的详细介绍
            3. 交通建议
            4. 预算分配明细
            5. 注意事项

            请以JSON格式输出，结构如下：
            ${SCHEMA_SPEC}

            ${SCHEMA_OUTPUT_INSTRUCTION}`)
        ]
    }

    // 修改行程的初始消息（Phase 11）：工具协议 + 旧行程 JSON + 修改指令。
    // 与 getTravelPrompt 共用 TOOL_PROTOCOL / SCHEMA_SPEC（prompt 单一事实来源）
    getRefinePrompt(oldPlan, instruction) {
        return [
            new SystemMessage(TOOL_PROTOCOL),
            new HumanMessage(`用户之前规划过以下行程：

${JSON.stringify(oldPlan, null, 2)}

用户希望这样修改：${instruction}

请先调用工具重新获取${oldPlan.city}的真实资料（get_weather 1 次 + search_attractions 最多 2 次），
然后在保留原行程合理部分的基础上落实修改要求，生成一份新的完整行程规划。
约束：天数保持 ${oldPlan.days} 天不变；总预算不得超过 ${oldPlan.totalBudget} 元。

请以JSON格式输出，结构如下：
${SCHEMA_SPEC}

${SCHEMA_OUTPUT_INSTRUCTION}`)
        ]
    }

    //流式对话（带会话状态：多轮记忆 + 行程草案上下文）
    async chat(sessionId, message, streamCallback) {
        const session = await stateManager.getSession(sessionId)

        // 组装消息：系统提示（含行程草案上下文）+ 会话历史 + 本轮新消息
        const messages = [
            new SystemMessage(this.buildChatSystemPrompt(session)),
            ...(session?.history ?? []).map(m =>
                m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
            ),
            new HumanMessage(message)
        ]

        try {
            //调用大模型
            const stream = await this.callUpstream(() => this.llm.stream(messages))
            let fullResponse = ''
            for await (const chunk of stream) {
                const content = chunk.content || ''
                //如果为空，跳过
                if(content.trim() === ''){
                    continue
                }
                fullResponse += content
                if(streamCallback){
                    streamCallback(content)
                }
            }

            // 本轮对话写回会话状态（成功才写，失败不污染历史）
            await stateManager.appendMessage(sessionId, 'user', message)
            await stateManager.appendMessage(sessionId, 'assistant', fullResponse)

            return {
                success: true,
                response: fullResponse
            }
        } catch (error) {
            logger.error('流式对话失败：', error)
            return {
                success: false,
                error: error.message
            }
        }

    }

    // 聊天系统提示：基础角色 + 行程上下文（如果有）。
    // chat 只负责"问"：用户询问行程细节时基于已有行程回答；
    // "改"交给 detail 页的「修改行程」（/refine）——chat 不能改行程，只能指路。
    buildChatSystemPrompt(session) {
        let prompt = '你是一个友好热情的旅游助手，请用中文回答用户关于旅游的所有的问题。'
        if (session?.tripPlan) {
            prompt += `\n用户当前的行程：${session.tripPlan.city} ${session.tripPlan.days} 天，总预算 ${session.tripPlan.totalBudget} 元。` +
                `用户询问行程细节时请基于该行程回答；` +
                `如果用户想修改行程，请告诉他可以在行程详情页使用「修改行程」功能（你无法直接修改行程）。`
        }
        return prompt
    }

}

export default TravelService
