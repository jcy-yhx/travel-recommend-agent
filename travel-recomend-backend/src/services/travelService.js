import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'
import { extractJson } from '../utils/extractJson.js'
import { TravelPlanSchema, PlanOutlineSchema, summarizeZodError } from './travelPlanSchema.js'
import { TOOLS, executeToolCall } from '../tools/index.js'
import { stateManager } from './stateManager.js'
import { validatePlan } from './planValidator.js'

// 结构化输出校验失败后的最大重试次数（不含首次调用）
const MAX_RETRIES = 2
// Agent Loop 的最大迭代轮数（含第一轮强制工具调用）
const MAX_AGENT_ITERATIONS = 5

class TravelService {
    constructor() {
        this.llm = null
        this.structuredLlm = null
        this.toolLlm = null
        this.initLLM()
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
            // 请求超时：防止 LLM 挂死时请求无限等待
            timeout: 60000,
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

    async recommend(city, budget, days, sessionId = null) {
        // 参数校验已由路由层完成（HTTP 边界返回 400）

        // 两个绑定工具的模式：
        // - required：强制调用工具（第一轮用，保证 grounding——实测 auto 会偷懒）
        // - auto：模型自己决定"继续调工具"还是"准备回答"（后续轮次用）
        const llmForceTools = this.toolLlm.bindTools(TOOLS, { tool_choice: 'required' })
        const llmWithTools = this.toolLlm.bindTools(TOOLS)
        const messages = this.getTravelPrompt(city, budget, days)

        // —— Agent Loop：Tool Call → Tool Result → LLM → …… 直到模型停止请求工具 ——
        await this.runAgentLoop(messages, llmForceTools, llmWithTools)

        // —— 答案阶段（Phase 06）：plan-then-execute + 校验 + 一次 re-plan ——
        const plan = await this.generatePlanWithReflection(messages, { budget, days })

        // 行程草案写入会话状态：之后 chat 可以引用"用户刚才规划的行程"
        if (sessionId) {
            stateManager.setTripPlan(sessionId, plan)
        }
        return plan
    }

    // plan-then-execute + Reflection（克制版）：
    // ① Planner：先出大纲（每天主题 + 景点 + 总预算），把"骨架"定下来
    // ② Executor：按大纲展开为完整行程（Phase 01 的格式校验 + 重试原样保留）
    // ③ Validator：语义校验（预算一致性/天数/明细求和，见 planValidator.js）
    // ④ Reflection：校验失败 → 把错误反馈给模型 → re-plan 一次 → 仍失败则 500
    async generatePlanWithReflection(messages, constraints) {
        // ① Planner：大纲（失败不阻塞——跳过规划步骤直接展开，可降级）
        const outlinePrompt = new HumanMessage(
            `基于以上工具返回的真实资料，先输出一份行程大纲（不要细节），结构如下：` +
            `{"city":"城市名","days":天数,"totalBudget":总预算,"dailyOutline":[{"day":1,"theme":"当日主题","spots":["景点1","景点2"]}]}。` +
            `要求：总预算不得超过 ${constraints.budget} 元；只输出 JSON 对象本身。`
        )
        const outline = await this.generateOutline([...messages, outlinePrompt])
        if (outline) {
            messages.push(outlinePrompt)
            messages.push(outline)
            console.log(`[Planner] 行程大纲生成成功：${outline.content ? JSON.parse(extractJson(outline.content)).dailyOutline.length : '?'} 天`)
        }

        // ② Executor：按大纲展开完整行程
        messages.push(new HumanMessage(
            '现在把行程大纲展开为完整行程：每天的上午/下午/晚上安排（景点、时长、门票、交通、介绍），' +
            '并给出预算分配明细。预算分配明细的合计必须与总预算一致。只输出 JSON 对象本身。'
        ))
        messages.push(await this.structuredLlm.invoke(messages))
        const plan = await this.validatePlanWithRetries(messages)

        // ③ Validator：语义校验（格式校验通过后才进入这层）
        const result = validatePlan(constraints, plan)
        if (result.valid) {
            console.log('[Validator] 行程校验通过')
            return plan
        }
        console.error('[Validator] 行程校验失败：', result.errors.join('；'))

        // ④ Reflection：一次 re-plan——把校验错误反馈给模型重新生成
        console.log('[Reflection] 触发 re-plan（1/1）')
        messages.push(new HumanMessage(
            `你生成的行程存在以下问题：${result.errors.join('；')}。` +
            `请修正这些问题后重新输出完整的行程 JSON（结构与之前相同，只输出 JSON 对象本身）。`
        ))
        messages.push(await this.structuredLlm.invoke(messages))
        const replanned = await this.validatePlanWithRetries(messages)

        const result2 = validatePlan(constraints, replanned)
        if (result2.valid) {
            console.log('[Reflection] re-plan 修复成功')
            return replanned
        }
        throw new Error(`行程校验失败（re-plan 后仍不通过）：${result2.errors.join('；')}`)
    }

    // 生成行程大纲：解析 + 校验，失败带反馈重试一次；仍失败返回 null（降级：跳过规划）
    async generateOutline(messages) {
        for (let attempt = 0; attempt <= 1; attempt++) {
            try {
                const response = await this.structuredLlm.invoke(messages)
                const json = JSON.parse(extractJson(response.content))
                PlanOutlineSchema.parse(json)
                return response
            } catch (error) {
                const reason = summarizeZodError(error) || error.message
                console.error(`[Planner] 大纲生成失败（第 ${attempt + 1} 次）：${reason}`)
                if (attempt === 0) {
                    messages.push(new HumanMessage(
                        `你上一次输出的大纲无法解析，错误信息：${reason}。请重新输出大纲 JSON。`
                    ))
                }
            }
        }
        console.warn('[Planner] 大纲连续失败，跳过规划步骤直接生成完整行程（降级）')
        return null
    }

    // Agent Loop：模型反复"请求工具 → 拿到结果 → 再决策"，直到它停止请求工具。
    // 终止条件有两个（互为保险）：
    // 1. 模型返回不含 tool_calls 的回答（自主终止）
    // 2. 达到 MAX_AGENT_ITERATIONS（防无限循环——模型陷入工具调用死循环时的兜底）
    async runAgentLoop(messages, llmForceTools, llmWithTools) {
        // 第一轮：required 强制 grounding，保证信息收集从工具开始
        let response = await llmForceTools.invoke(messages)
        messages.push(response)
        let iterations = 1
        console.log(`[Agent Loop] 第 1 轮：${response.tool_calls?.length ?? 0} 次工具调用`,
            response.tool_calls?.map(tc => tc.name).join(', ') || '（无）')

        while (response.tool_calls?.length && iterations < MAX_AGENT_ITERATIONS) {
            // 执行本轮所有工具调用，结果作为 ToolMessage 回写（失败也回写 error）
            for (const toolCall of response.tool_calls) {
                const toolMessage = await executeToolCall(toolCall)
                console.log(`[Agent Loop] 工具 ${toolCall.name}(${JSON.stringify(toolCall.args)}) 执行结果：`,
                    toolMessage.content.slice(0, 100))
                messages.push(toolMessage)
            }

            // 下一轮：auto 模式，让模型基于工具结果自主决策——继续调工具，或停止
            response = await llmWithTools.invoke(messages)
            messages.push(response)
            iterations++
            console.log(`[Agent Loop] 第 ${iterations} 轮：${response.tool_calls?.length ?? 0} 次工具调用`,
                response.tool_calls?.map(tc => tc.name).join(', ') || '（模型停止请求工具）')
        }

        // 兜底：达到最大轮数仍在请求工具 → 明确失败，而不是无限烧 token
        if (response.tool_calls?.length) {
            throw new Error(`Agent 达到最大迭代次数（${MAX_AGENT_ITERATIONS} 轮）仍未停止工具调用`)
        }
        console.log(`[Agent Loop] 结束：共 ${iterations} 轮`)
        return iterations
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
                console.error(`第 ${attempt + 1} 次结构化输出失败：${reason}`)

                // 带反馈的重试：告诉模型上一次输出错在哪，而不是盲目重发同一请求
                messages.push(new HumanMessage(
                    `你上一次的输出无法解析，错误信息：${reason}。` +
                    `请重新输出，必须严格符合要求的结构，且只输出 JSON 对象本身。`
                ))
                messages.push(await this.structuredLlm.invoke(messages))
            }
        }

        // 重试耗尽仍然失败：抛出异常，由全局错误中间件返回 500
        throw new Error(`模型输出解析失败（已重试 ${MAX_RETRIES} 次）：${summarizeZodError(lastError) || lastError.message}`)
    }

    getTravelPrompt(city, budget, days){
        return [
            // 工具使用协议放在 SystemMessage：角色级指令对 tool calling 的
            // 约束力远强于塞在用户消息里（实测：写在 HumanMessage 里模型经常跳过工具）
            new SystemMessage(`你是专业的旅游规划师。规划前必须先调用工具获取真实资料：
- 调用 get_weather 查询目的地天气（1 次即可）
- 调用 search_attractions 检索目的地景点（1-2 次即可，信息足够就停止检索）
然后基于工具返回的真实资料生成行程。
约束：检索预算有限，不要反复搜索同一目的地；工具结果不完整时，用你的知识补充并注明不确定性。`),
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
            {
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
                    "ticket": "门票价格（字符串，如\"60元\"或\"免费\"）",
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
            }

            重要：只输出 JSON 对象本身，不要输出任何解释性文字，不要用代码围栏包裹。`)
        ]
    }

    //流式对话（带会话状态：多轮记忆 + 行程草案上下文）
    async chat(sessionId, message, streamCallback) {
        const session = stateManager.getSession(sessionId)

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
            const stream = await this.llm.stream(messages)
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
            stateManager.appendMessage(sessionId, 'user', message)
            stateManager.appendMessage(sessionId, 'assistant', fullResponse)

            return {
                success: true,
                response: fullResponse
            }
        } catch (error) {
            console.error('流式对话失败：', error)
            return {
                success: false,
                error: error.message
            }
        }

    }

    // 聊天系统提示：基础角色 + 行程草案上下文（如果有）
    buildChatSystemPrompt(session) {
        let prompt = '你是一个友好热情的旅游助手，请用中文回答用户关于旅游的所有的问题。'
        if (session?.tripPlan) {
            prompt += `\n用户当前的行程草案：${session.tripPlan.city} ${session.tripPlan.days} 天，总预算 ${session.tripPlan.totalBudget} 元。` +
                `如果用户询问或修改行程，请基于该草案回答。`
        }
        return prompt
    }

}

export default TravelService
