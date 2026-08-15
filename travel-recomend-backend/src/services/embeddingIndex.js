import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { OpenAIEmbeddings } from '@langchain/openai'

const DEFAULT_INDEX_FILE = new URL('../data/attractions-embeddings.json', import.meta.url)

// 相似度阈值：低于该值的检索结果视为"不相关"。
// 语义检索永远会返回"最接近"的结果——没有阈值时，再离谱的查询也会
// 带回一堆垃圾。宁可返回空结果（触发优雅降级），不给无关内容。
// 阈值来自真实数据校准（npm run eval:retrieval）：
// 相关查询 0.50~0.63，无关查询 0.47 → 取 0.48
export const SIMILARITY_THRESHOLD = 0.48

// 余弦相似度：bge-m3 等 embedding 模型的标准相似度度量（-1 ~ 1，越大越相关）
export function cosineSimilarity(a, b) {
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function createEmbedder() {
    return new OpenAIEmbeddings({
        configuration: { baseURL: process.env.SILICONFLOW_BASE_URL },
        apiKey: process.env.SILICONFLOW_API_KEY,
        model: process.env.SILICONFLOW_EMBEDDING_MODEL,
        batchSize: 32
    })
}

// EmbeddingIndex：景点的向量索引。
// 设计（RAG-lite，刻意不上向量数据库）：
// - 离线构建：全部景点一次性批量向量化，缓存到 JSON 文件（22 条 × 1024 维 ≈ 90KB）
// - 查询时只向量化 query（1 次 API 调用），内存里做余弦相似度 + top-K
// - 为什么不上向量库（pgvector/Milvus）：数据量只有几十条，暴力扫描毫秒级；
//   向量库解决的是"百万级向量 + 毫秒级检索"的问题，当前规模引入它纯属负担
export class EmbeddingIndex {
    constructor({ filePath = DEFAULT_INDEX_FILE, embedder } = {}) {
        this.filePath = filePath
        this.embedder = embedder ?? createEmbedder()
        this.index = null   // { model, texts, vectors }
    }

    // 加载缓存索引；缓存缺失/内容变化/模型更换时重建（重建 = 1 次批量 API 调用）
    async loadOrBuild(texts) {
        if (existsSync(this.filePath)) {
            try {
                const cached = JSON.parse(readFileSync(this.filePath, 'utf-8'))
                const isFresh = cached.model === process.env.SILICONFLOW_EMBEDDING_MODEL
                    && cached.texts?.join('|') === texts.join('|')
                if (isFresh) {
                    this.index = cached
                    console.log(`[EmbeddingIndex] 从缓存加载索引：${cached.vectors.length} 条向量`)
                    return
                }
                console.log('[EmbeddingIndex] 缓存已过期（数据或模型变化），重建索引')
            } catch (error) {
                console.error('[EmbeddingIndex] 缓存读取失败，重建索引：', error.message)
            }
        }

        const vectors = await this.embedder.embedDocuments(texts)
        this.index = { model: process.env.SILICONFLOW_EMBEDDING_MODEL, texts, vectors }
        writeFileSync(this.filePath, JSON.stringify(this.index))
        console.log(`[EmbeddingIndex] 索引构建完成并缓存：${vectors.length} 条向量`)
    }

    // 语义检索：返回 [{ index, score }]，按相似度降序、top-K、阈值过滤
    async search(query, k = 5) {
        if (!this.index) {
            throw new Error('索引未构建，请先调用 loadOrBuild')
        }
        const queryVector = await this.embedder.embedQuery(query)
        return this.index.vectors
            .map((vector, index) => ({ index, score: cosineSimilarity(queryVector, vector) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k)
            .filter(item => item.score >= SIMILARITY_THRESHOLD)
    }
}
