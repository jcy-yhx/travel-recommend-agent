import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { extractJson } from '../utils/extractJson.js'
import { TravelPlanSchema, summarizeZodError } from './travelPlanSchema.js'

// 结构化输出校验失败后的最大重试次数（不含首次调用）
const MAX_RETRIES = 2

class TravelService {
    constructor() {
        this.llm = null
        this.structuredLlm = null
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
    }

    async recommend(city, budget, days) {
        // 参数校验已由路由层完成（HTTP 边界返回 400）

        // 拿到提示词数据
        const messages = [this.getTravelPrompt(city, budget, days)]
        let lastError = null

        // 结构化输出循环：调用 → 提取 → 校验；失败则把错误反馈给模型重试
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await this.structuredLlm.invoke(messages)
                // extractJson 返回的是字符串，需要 JSON.parse 转成对象再校验
                const json = JSON.parse(extractJson(response.content))
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
            }
        }

        // 重试耗尽仍然失败：抛出异常，由全局错误中间件返回 500
        throw new Error(`模型输出解析失败（已重试 ${MAX_RETRIES} 次）：${summarizeZodError(lastError) || lastError.message}`)
    }

    getTravelPrompt(city, budget, days){
        return new HumanMessage(`你是一个专业的旅游规划师，擅长根据用户的需求生成详细的旅行行程。
            请根据以下信息为用户生成一份详细的旅游规划：
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

            重要：只输出 JSON 对象本身，不要输出任何解释性文字，不要用代码围栏包裹。`);
    }

    //流式对话
    async chat(message, streamCallback) {
        //组装参数
        const messages = [
            new SystemMessage('你是一个友好热情的旅游助手，请用中文回答用户关于旅游的所有的问题'),
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

}

export default TravelService
