import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { EmbeddingIndex, cosineSimilarity, SIMILARITY_THRESHOLD } from '../services/embeddingIndex.js'

// EmbeddingIndex 的确定性测试：注入 fake embedder，不调用真实 API。
// 用"手工构造的向量"让余弦相似度结果可预测。

// 手工向量：让 A 与 B 相似、与 C 正交
const vecA = [1, 0, 0, 0]
const vecB = [1, 0, 0, 0]      // 与 A 完全相同 → 相似度 1
const vecC = [0, 1, 0, 0]      // 与 A 正交 → 相似度 0
const vecD = [0.5, 0, 0, 0]    // 与 A 同向 → 相似度 1（余弦只关心方向）

function makeFakeEmbedder({ documents, query } = {}) {
    return {
        embedDocuments: async () => documents ?? [vecA, vecC, vecD],
        embedQuery: async () => query ?? vecB
    }
}

function makeTempFile() {
    return join(tmpdir(), `travel-test-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
}

// ---------- cosineSimilarity ----------

test('完全相同向量余弦相似度为 1', () => {
    assert.equal(cosineSimilarity(vecA, vecB), 1)
})

test('正交向量余弦相似度为 0', () => {
    assert.equal(cosineSimilarity(vecA, vecC), 0)
})

// ---------- 索引构建与缓存 ----------

test('首次构建：调用 embedder 并写缓存文件', async () => {
    const file = makeTempFile()
    let embedCalls = 0
    const index = new EmbeddingIndex({
        filePath: file,
        embedder: { embedDocuments: async () => { embedCalls++; return [vecA] }, embedQuery: async () => vecA }
    })
    await index.loadOrBuild(['测试文本'])
    assert.equal(embedCalls, 1)
    rmSync(file, { force: true })
})

test('缓存命中：第二次启动不调用 embedder（零 API 成本）', async () => {
    const file = makeTempFile()
    let embedCalls = 0
    const embedder = { embedDocuments: async () => { embedCalls++; return [vecA] }, embedQuery: async () => vecA }

    const first = new EmbeddingIndex({ filePath: file, embedder })
    await first.loadOrBuild(['相同文本'])

    // 模拟重启：新实例 + 同一文件 + 同一模型配置
    const second = new EmbeddingIndex({ filePath: file, embedder })
    await second.loadOrBuild(['相同文本'])
    assert.equal(embedCalls, 1)   // 没有第二次调用
    rmSync(file, { force: true })
})

test('缓存过期：文本变化时重建索引', async () => {
    const file = makeTempFile()
    let embedCalls = 0
    const embedder = { embedDocuments: async () => { embedCalls++; return [vecA] }, embedQuery: async () => vecA }

    const first = new EmbeddingIndex({ filePath: file, embedder })
    await first.loadOrBuild(['旧文本'])

    const second = new EmbeddingIndex({ filePath: file, embedder })
    await second.loadOrBuild(['新文本'])
    assert.equal(embedCalls, 2)   // 重建了
    rmSync(file, { force: true })
})

// ---------- 检索与阈值 ----------

test('search 返回 top-K 且按相似度降序，低于阈值的被过滤', async () => {
    const file = makeTempFile()
    // 三个文档向量：与查询的相似度分别为 1.0、0.0、1.0
    const index = new EmbeddingIndex({
        filePath: file,
        embedder: makeFakeEmbedder({ documents: [vecA, vecC, vecD], query: vecB })
    })
    await index.loadOrBuild(['a', 'c', 'd'])

    const results = await index.search('任意查询', 5)
    // 相似度 1.0 的两个（vecA、vecD）保留，正交的 vecC 被阈值过滤
    assert.equal(results.length, 2)
    assert.equal(results[0].score, 1)
    assert.equal(results[1].score, 1)
    assert.ok(results.every(r => r.score >= SIMILARITY_THRESHOLD))
    rmSync(file, { force: true })
})

test('未构建索引就 search 抛明确错误', async () => {
    const index = new EmbeddingIndex({ filePath: makeTempFile(), embedder: makeFakeEmbedder() })
    await assert.rejects(() => index.search('x'), /索引未构建/)
})
