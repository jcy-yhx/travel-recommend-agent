// 端到端评估脚本：真实调用 recommend，用"规则分 + LLM-as-judge 质量分"
// 对行程评分。运行：npm run eval:e2e [offset] [limit]（分批跑，每批 3 个用例）
//
// 评估的三层体系（本脚本是第三层）：
// 1. 确定性单测（npm test）：格式层 + 循环行为的回归
// 2. 检索 eval（npm run eval:retrieval）：检索层质量
// 3. 端到端 eval（本脚本）：完整行程质量（规则 + LLM-judge）
//
// 注意：会真实消耗 API 配额（每个用例 ≈ 6-8 次 LLM 调用）。
import 'dotenv/config.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { z } from 'zod'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import TravelService from '../src/services/travelService.js'
import { validatePlan } from '../src/services/planValidator.js'
import { extractJson } from '../src/utils/extractJson.js'
import { sumMessagesUsage } from '../src/utils/tokenStats.js'

const CASES = [
    { id: 'E2E-01', city: '北京', budget: 1500, days: 2 },
    { id: 'E2E-02', city: '上海', budget: 2000, days: 3 },
    { id: 'E2E-03', city: '成都', budget: 500, days: 1 },
    { id: 'E2E-04', city: '三亚', budget: 1500, days: 2 },
    { id: 'E2E-05', city: '西安', budget: 2500, days: 4 },
    { id: 'E2E-06', city: '杭州', budget: 800, days: 2 }
]

// LLM-as-judge 的输出契约
const JudgeSchema = z.object({
    score: z.number().min(1).max(5),
    dimensions: z.object({
        reasonableness: z.number().min(1).max(5),      // 行程合理性（节奏/密度）
        budgetRealism: z.number().min(1).max(5),       // 预算现实性（住宿0元要扣分）
        attractionAccuracy: z.number().min(1).max(5),  // 景点真实性（名称/门票/时长）
        descriptionQuality: z.number().min(1).max(5)   // 描述质量（具体/有用）
    }),
    strengths: z.array(z.string()),
    issues: z.array(z.string())
})

function buildJudgePrompt(city, budget, days, plan) {
    return new HumanMessage(`你是资深的旅游规划评审专家。请按以下 rubric 对行程打分（每项 1-5 分）：
1. reasonableness 行程合理性：每天安排密度是否合理、景点间交通是否顺路
2. budgetRealism 预算现实性：预算分配是否符合常识（住宿 0 元这类不现实安排要扣分）
3. attractionAccuracy 景点真实性：景点名称、门票、时长是否符合事实
4. descriptionQuality 描述质量：介绍是否具体、对游客有用

用户约束：${city} ${days} 天，预算 ${budget} 元。
行程 JSON：
${JSON.stringify(plan)}

请输出 JSON：
{"score": 综合分, "dimensions": {"reasonableness": n, "budgetRealism": n, "attractionAccuracy": n, "descriptionQuality": n}, "strengths": ["优点"], "issues": ["问题"]}`)
}

// 用 LLM 给行程打分（失败降级：返回 0 分 + 错误，不让评估流程中断）
async function judgePlan(service, city, budget, days, plan) {
    try {
        const messages = [
            new SystemMessage('你是严格的评审专家，只输出 JSON，不输出其他内容。'),
            buildJudgePrompt(city, budget, days, plan)
        ]
        const response = await service.structuredLlm.invoke(messages)
        const json = JSON.parse(extractJson(response.content))
        return { judge: JudgeSchema.parse(json), judgeRaw: null }
    } catch (error) {
        return { judge: null, judgeRaw: `judge 失败：${error.message?.slice(0, 80)}` }
    }
}

async function runCase(service, testCase) {
    const { id, city, budget, days } = testCase
    const startedAt = Date.now()
    try {
        // 复用内部逻辑：直接调 recommend（含图执行），但我们需要 messages 统计 token，
        // 所以这里用 service.recommend + 单独统计不了 messages——改为直接调图
        const result = await service.graph.invoke({
            messages: service.getTravelPrompt(city, budget, days),
            constraints: { budget, days },
            agentIterations: 0,
            replanCount: 0
        })
        const plan = result.plan
        const usage = sumMessagesUsage(result.messages)

        // 规则分：5 条确定性规则（预算/天数/明细）
        const rules = validatePlan({ budget, days }, plan)

        // 质量分：LLM-as-judge
        const { judge, judgeRaw } = await judgePlan(service, city, budget, days, plan)

        return {
            id, city, budget, days,
            status: 'OK',
            durationSec: ((Date.now() - startedAt) / 1000).toFixed(1),
            rulePass: rules.valid,
            judgeScore: judge?.score ?? null,
            dimensions: judge?.dimensions ?? null,
            strengths: judge?.strengths?.slice(0, 2) ?? [],
            issues: judge?.issues?.slice(0, 2) ?? [],
            judgeRaw,
            usage
        }
    } catch (error) {
        return {
            id, city, budget, days,
            status: 'FAIL',
            error: error.message?.slice(0, 120),
            durationSec: ((Date.now() - startedAt) / 1000).toFixed(1)
        }
    }
}

// 主流程：支持分批（offset/limit），避免单次运行超时
const offset = Number(process.argv[2] ?? 0)
const limit = Number(process.argv[3] ?? CASES.length)
const batch = CASES.slice(offset, offset + limit)

console.log(`评估批次：用例 ${offset + 1}-${offset + batch.length} / 共 ${CASES.length}`)
const service = new TravelService()
const results = []

for (const testCase of batch) {
    console.log(`\n=== 运行 ${testCase.id}：${testCase.city} ${testCase.days} 天 ${testCase.budget} 元 ===`)
    const r = await runCase(service, testCase)
    results.push(r)
    console.log(`  状态: ${r.status} | 耗时: ${r.durationSec}s | 规则: ${r.rulePass ? '通过' : '失败'} | judge: ${r.judgeScore ?? 'N/A'}`)
    if (r.usage) {
        console.log(`  token: 输入 ${r.usage.inputTokens} + 输出 ${r.usage.outputTokens}`)
    }
    if (r.issues?.length) console.log(`  问题: ${r.issues.join('；')}`)
}

// 汇总
const ok = results.filter(r => r.status === 'OK')
const rulePassCount = ok.filter(r => r.rulePass).length
const judgeScores = ok.filter(r => r.judgeScore != null).map(r => r.judgeScore)
const avgScore = judgeScores.length ? (judgeScores.reduce((a, b) => a + b, 0) / judgeScores.length).toFixed(2) : 'N/A'
const totalInput = results.reduce((s, r) => s + (r.usage?.inputTokens ?? 0), 0)
const totalOutput = results.reduce((s, r) => s + (r.usage?.outputTokens ?? 0), 0)

const summary = `
## 端到端评估汇总（批次 ${offset + 1}-${offset + batch.length}）

| 指标 | 值 |
|---|---|
| 用例通过率 | ${ok.length}/${batch.length} |
| 规则校验通过率 | ${rulePassCount}/${ok.length} |
| judge 平均分 | ${avgScore} / 5 |
| 本批 token 消耗 | 输入 ${totalInput} + 输出 ${totalOutput} |

### 明细

| 用例 | 城市 | 预算/天数 | 状态 | 规则 | judge | 维度 | 主要问题 |
|---|---|---|---|---|---|---|---|
${results.map(r =>
    `| ${r.id} | ${r.city} | ${r.budget}/${r.days}天 | ${r.status} | ${r.rulePass ? '✅' : '❌'} | ${r.judgeScore ?? '-'} | ${r.dimensions ? JSON.stringify(r.dimensions) : '-'} | ${(r.issues ?? (r.error ? [r.error] : [])).join('；') || '-'} |`
).join('\n')}
`

console.log(summary)

// 保存报告（面试可展示的评估记录）——存到仓库顶层 docs/eval/
const reportDir = new URL('../../docs/eval/', import.meta.url)
mkdirSync(reportDir, { recursive: true })
const reportFile = new URL(`latest-batch-${offset}-${offset + batch.length}.md`, reportDir)
writeFileSync(reportFile, summary + `\n> 生成时间：${new Date().toISOString()}\n`)
console.log(`报告已保存：${reportFile.pathname}`)
