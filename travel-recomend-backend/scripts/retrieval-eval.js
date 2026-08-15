// 检索质量评估脚本：对比"关键词检索 vs 语义检索"在同一批查询上的表现。
// 运行：npm run eval:retrieval（真实调用 embedding API，会消耗少量配额）
//
// 每个用例：query = 用户可能的自然语言问法；expect = 期望命中的景点。
// 语义检索的输出还会打印 top-1 相似度分数，用于校准 SIMILARITY_THRESHOLD。
import 'dotenv/config.js'
import { readFileSync } from 'node:fs'
import { EmbeddingIndex } from '../src/services/embeddingIndex.js'

const ATTRACTIONS = JSON.parse(readFileSync(new URL('../src/data/attractions.json', import.meta.url), 'utf-8'))

// 与 tools/attractions.js 保持一致的关键词检索（仅用于对比）
function keywordSearch(query) {
    const keywords = query.split(/[\s,，、]+/).filter(Boolean)
    return ATTRACTIONS
        .map((attraction, index) => {
            let score = 0
            for (const keyword of keywords) {
                if (attraction.name.includes(keyword)) score += 3
                if (attraction.city.includes(keyword)) score += 2
                if (attraction.category.includes(keyword) || attraction.description.includes(keyword)) score += 1
            }
            return { index, score }
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
}

const CASES = [
    { query: '明清皇宫', expect: '故宫博物院' },
    { query: '海边度假', expect: '亚龙湾' },
    { query: '在明朝城墙上骑自行车', expect: '西安城墙' },
    { query: '看国宝大熊猫', expect: '成都大熊猫繁育研究基地' },
    { query: '皇家园林，昆明湖', expect: '颐和园' },
    { query: '上海看夜景', expect: '外滩' },
    { query: '吃小笼包的地方', expect: '豫园' },
    { query: '量子力学实验室参观', expect: null },        // 不相关查询：期望空结果
]

const texts = ATTRACTIONS.map(a => `${a.city} ${a.name} ${a.category} ${a.description}`)
const index = new EmbeddingIndex()
await index.loadOrBuild(texts)

let semanticPass = 0
let keywordPass = 0

console.log('| 查询 | 期望 | 关键词 top1 | 语义 top1（分数） |')
console.log('|---|---|---|---|')

for (const { query, expect } of CASES) {
    const kw = keywordSearch(query)
    const kwTop = kw.length ? ATTRACTIONS[kw[0].index].name : '（无结果）'

    const sem = await index.search(query, 3)
    const semTop = sem.length ? `${ATTRACTIONS[sem[0].index].name}（${sem[0].score.toFixed(3)}）` : '（无结果）'

    const kwHit = kw.length && kw.some(i => ATTRACTIONS[i.index].name === expect)
    const semHit = sem.length && sem.some(i => ATTRACTIONS[i.index].name === expect)
    const semCorrect = expect === null ? sem.length === 0 : semHit

    if (kwHit) keywordPass++
    if (semCorrect) semanticPass++

    console.log(`| ${query} | ${expect ?? '（空）'} | ${kwTop} | ${semTop} |`)
}

console.log(`\n关键词检索命中：${keywordPass}/${CASES.length}`)
console.log(`语义检索命中：${semanticPass}/${CASES.length}`)
