import { tool } from '@langchain/core/tools'
import { z } from 'zod'

// Mock 天气数据：本阶段学习目标是"模型如何自主调用工具"，而不是天气数据本身。
// 替换点：把 MOCK_WEATHER 的查表逻辑换成真实天气 API（如和风天气 / OpenWeatherMap），
// 工具的 name / description / schema 完全不用改——这正是工具抽象的边界。
const MOCK_WEATHER = {
    '北京': { condition: '晴', temperature: 28, wind: '3级' },
    '上海': { condition: '多云', temperature: 30, wind: '4级' },
    '广州': { condition: '雷阵雨', temperature: 32, wind: '3级' },
    '深圳': { condition: '阵雨', temperature: 31, wind: '3级' },
    '成都': { condition: '小雨', temperature: 24, wind: '2级' },
    '杭州': { condition: '阴', temperature: 27, wind: '3级' },
    '西安': { condition: '晴', temperature: 26, wind: '2级' },
    '重庆': { condition: '多云', temperature: 33, wind: '2级' },
    '南京': { condition: '多云', temperature: 29, wind: '3级' },
    '武汉': { condition: '晴', temperature: 31, wind: '3级' },
    '苏州': { condition: '小雨', temperature: 26, wind: '2级' },
    '长沙': { condition: '晴', temperature: 32, wind: '3级' },
    '昆明': { condition: '晴', temperature: 22, wind: '2级' },
    '三亚': { condition: '晴', temperature: 30, wind: '3级' },
    '厦门': { condition: '多云', temperature: 28, wind: '3级' },
    '青岛': { condition: '雾', temperature: 24, wind: '4级' }
}

export const getWeather = tool(
    async ({ city, date }) => {
        const weather = MOCK_WEATHER[city]
        if (!weather) {
            // 未知城市：返回 error 字段而不是抛异常——
            // 让模型读到"查不到"并自行调整，而不是让工具层报错打断流程
            return { city, date: date || '今天', error: '暂无该城市的天气数据（Mock 数据未覆盖）' }
        }
        return { city, date: date || '今天', ...weather }
    },
    {
        name: 'get_weather',
        description: '查询指定城市的天气（Mock 数据）。旅行规划前调用，用于了解目的地天气并安排合适的行程。',
        schema: z.object({
            city: z.string().describe('城市名，如"北京"'),
            date: z.string().optional().describe('日期，格式 YYYY-MM-DD，缺省为今天')
        })
    }
)
