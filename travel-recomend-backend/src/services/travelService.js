import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
class TravelService {
    constructor() {
        this.llm = null
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

        this.llm = new ChatOpenAI({
            configuration: {
                baseURL
            },
            apiKey,
            model,
            temperature: 0.7,
            streaming:true,
            // 成本控制：限制单次回复最大 token 数
            maxTokens: 4096,
            // 请求超时：防止 LLM 挂死时请求无限等待
            timeout: 60000
        })
    }

    async recommend(city, budget, days) {
        // 参数校验已由路由层完成（HTTP 边界返回 400）

        // 拿到提示词数据
        const message = this.getTravelPrompt(city, budget, days)

        try {
            // 调用 LLM
            const response = await this.llm.invoke([message])
            // console.log(response)
            const fullResponse = response.content

            // console.log('LLM原始返回：')
            // console.log(fullResponse)

            // 提取 JSON
            const match =
                fullResponse.match(/```json\s*([\s\S]*?)\s*```/) ||
                fullResponse.match(/```\s*([\s\S]*?)\s*```/) ||
                fullResponse.match(/\{[\s\S]*\}/)

            if (!match) {
                throw new Error('模型输出格式错误')
            }

            // 有捕获组取 match[1]
            // 没有捕获组取 match[0]
            const jsonStr = match[1] || match[0]

            // console.log('提取出来的JSON：')
            // console.log(jsonStr)

            const json = JSON.parse(jsonStr)

            return json

        } catch (error) {
            console.error('JSON解析失败：', error)

            return {
                success: false,
                error: 'JSON解析失败',
                rawResponse: error.message
            }
        }
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
            "success": true,
            "city": "城市名",
            "days": 天数,
            "totalBudget": 总预算,
            "dailyItinerary": [
                {
                "day": 1,
                "date": "第1天",
                "morning": {
                    "spot": "景点名称",
                    "duration": "游览时长",
                    "ticket": "门票价格",
                    "transportation": "交通方式",
                    "description": "景点介绍"
                },
                "afternoon": {
                    "spot": "景点名称",
                    "duration": "游览时长",
                    "ticket": "门票价格",
                    "transportation": "交通方式",
                    "description": "景点介绍"
                },
                "evening": {
                    "spot": "活动名称",
                    "duration": "活动时长",
                    "ticket": "费用",
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

            请确保JSON格式正确，可以被解析。`);
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
                console.log(content)
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