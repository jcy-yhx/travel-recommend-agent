import { z } from 'zod'

// 行程片段的 schema（上午/下午/晚上共用同一结构）
const TravelSegmentSchema = z.object({
    spot: z.string(),
    duration: z.string(),
    ticket: z.string(),
    transportation: z.string(),
    description: z.string()
})

// 旅游计划的完整 schema —— LLM 输出必须满足这个契约。
// 注意：LLM 输出里不再有 "success" 字段——成功与否由 HTTP 状态码
// 和本 schema 的校验结果决定，模型只负责返回纯数据。
export const TravelPlanSchema = z.object({
    city: z.string(),
    days: z.number(),
    totalBudget: z.number(),
    dailyItinerary: z.array(z.object({
        day: z.number(),
        date: z.string(),
        morning: TravelSegmentSchema.optional(),
        afternoon: TravelSegmentSchema.optional(),
        evening: TravelSegmentSchema.optional()
    })),
    budgetBreakdown: z.object({
        accommodation: z.number(),
        food: z.number(),
        transportation: z.number(),
        tickets: z.number(),
        other: z.number()
    }).optional(),
    tips: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional()
})

// 把 zod 校验错误转成一段适合反馈给模型的文字，
// 用于重试时告诉模型"你上次错在哪"。
export function summarizeZodError(error) {
    const issues = error?.issues?.slice(0, 3) ?? []
    return issues
        .map(issue => `字段 "${issue.path.join('.')}" 校验失败：${issue.message}`)
        .join('；')
}
