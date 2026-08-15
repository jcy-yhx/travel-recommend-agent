import { readFileSync } from 'node:fs'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { EmbeddingIndex } from '../services/embeddingIndex.js'

// 本地景点知识库（JSON 文件）
const ATTRACTIONS = JSON.parse(
    readFileSync(new URL('../data/attractions.json', import.meta.url), 'utf-8')
)

// 语义索引：懒构建——首次检索时构建并缓存，之后零 API 成本
const embeddingIndex = new EmbeddingIndex()
let indexReady = false

async function ensureIndex() {
    if (!indexReady) {
        // 索引文本 = 每个景点的关键信息拼接（名称权重最高，城市/类别/描述辅助）
        const texts = ATTRACTIONS.map(a => `${a.city} ${a.name} ${a.category} ${a.description}`)
        await embeddingIndex.loadOrBuild(texts)
        indexReady = true
    }
}

// 语义检索：query 向量化后与索引做余弦相似度 top-5
async function searchSemantic(query) {
    await ensureIndex()
    const matches = await embeddingIndex.search(query)
    return { method: 'embedding', matches }
}

// 关键词检索（Phase 02 的实现，保留作为兜底）：
// 名称命中 > 城市命中 > 类别/描述命中
function keywordScoredResults(query) {
    const keywords = query.split(/[\s,，、]+/).filter(Boolean)
    return ATTRACTIONS
        .map((attraction, index) => {
            let score = 0
            for (const keyword of keywords) {
                if (attraction.name.includes(keyword)) score += 3
                if (attraction.city.includes(keyword)) score += 2
                if (attraction.category.includes(keyword) || attraction.description.includes(keyword)) score += 1
            }
            return { index, attraction, score }
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
}

const NO_MATCH_MESSAGE = '知识库中未收录该目的地的景点。请不要反复更换关键词重试，直接基于你对目的地的了解规划行程，并在相应景点介绍中注明"信息可能过时，请以官方渠道为准"。'

export const searchAttractions = tool(
    async ({ query }) => {
        // 主路径：语义检索（embedding）
        try {
            const { matches } = await searchSemantic(query)
            if (matches.length === 0) {
                return { query, method: 'embedding', results: [], message: NO_MATCH_MESSAGE }
            }
            return {
                query,
                method: 'embedding',
                results: matches.map(m => ATTRACTIONS[m.index])
            }
        } catch (error) {
            // 兜底路径：embedding API 不可用时回退关键词检索（优雅降级）
            console.error('[search_attractions] 语义检索失败，回退关键词检索：', error.message)
            const scored = keywordScoredResults(query)
            if (scored.length === 0) {
                return { query, method: 'keyword', results: [], message: NO_MATCH_MESSAGE }
            }
            return { query, method: 'keyword', results: scored.map(item => item.attraction) }
        }
    },
    {
        name: 'search_attractions',
        description: '在本地景点知识库中检索景点，返回名称、城市、类别、门票、游览时长、介绍和建议。支持自然语言语义检索（如"适合亲子游的景点""海边度假"），不必使用精确关键词。',
        schema: z.object({
            query: z.string().describe('检索描述，可以是自然语言（如"明清皇宫""适合拍照的园林"）或城市名')
        })
    }
)
