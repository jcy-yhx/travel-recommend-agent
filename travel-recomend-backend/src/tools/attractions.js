import { readFileSync } from 'node:fs'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

// 本地景点知识库（JSON 文件）。
// 本阶段用关键词打分检索；Phase 05（RAG）会升级为 embedding 向量检索。
const ATTRACTIONS = JSON.parse(
    readFileSync(new URL('../data/attractions.json', import.meta.url), 'utf-8')
)

// 简单打分检索：名称命中 > 城市命中 > 类别/描述命中，多关键词累加
function scoreAttraction(attraction, keywords) {
    let score = 0
    for (const keyword of keywords) {
        if (attraction.name.includes(keyword)) score += 3
        if (attraction.city.includes(keyword)) score += 2
        if (attraction.category.includes(keyword) || attraction.description.includes(keyword)) score += 1
    }
    return score
}

export const searchAttractions = tool(
    async ({ query }) => {
        const keywords = query.split(/[\s,，、]+/).filter(Boolean)
        const scored = ATTRACTIONS
            .map(attraction => ({ attraction, score: scoreAttraction(attraction, keywords) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)

        if (scored.length === 0) {
            return { query, results: [], message: '未找到匹配的景点，请尝试其他关键词' }
        }
        return { query, results: scored.map(item => item.attraction) }
    },
    {
        name: 'search_attractions',
        description: '在本地景点知识库中检索景点，返回名称、城市、类别、门票、游览时长、介绍和建议。用于行程规划时获取真实景点资料。',
        schema: z.object({
            query: z.string().describe('检索关键词，如"北京 博物馆"或"成都"')
        })
    }
)
