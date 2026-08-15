// 行程语义校验器：与 Phase 01 的 zod 格式校验互补。
//
// 分层（面试必讲）：
// - 格式层（Phase 01）：zod schema——字段类型对不对（"天数必须是数字"）
// - 语义层（本模块）：业务规则——数值合不合理（"预算不能超用户预算 10%"）
//
// 格式层保证"能被解析"，语义层保证"内容靠谱"。两者失败都走反馈重试，
// 但语义层的错误信息才是"模型该改什么"的真正依据。

// 预算容差：允许 totalBudget 超出用户预算 10% 以内（行程报价常有弹性空间）
export const BUDGET_TOLERANCE = 0.1
// 明细求和与总预算的允许偏差（同样 10%）
export const BREAKDOWN_TOLERANCE = 0.1

// 校验行程是否符合用户约束。返回 { valid, errors[] }
export function validatePlan(userConstraints, plan) {
    const errors = []

    // 1. 天数一致
    if (plan.days !== userConstraints.days) {
        errors.push(`行程天数（${plan.days} 天）与用户要求（${userConstraints.days} 天）不一致`)
    }

    // 2. 总预算不超用户预算（容差 10%）
    if (typeof plan.totalBudget !== 'number') {
        errors.push(`总预算缺失或不是数字（收到：${plan.totalBudget}）`)
    } else {
        const limit = userConstraints.budget * (1 + BUDGET_TOLERANCE)
        if (plan.totalBudget > limit) {
            errors.push(`总预算 ${plan.totalBudget} 元超出用户预算 ${userConstraints.budget} 元（容差 10%）`)
        }
    }

    // 3. 预算明细求和与总预算一致（偏差 ≤10%）
    if (!plan.budgetBreakdown) {
        errors.push('缺少预算分配明细（budgetBreakdown）')
    } else {
        const b = plan.budgetBreakdown
        const sum = b.accommodation + b.food + b.transportation + b.tickets + b.other
        if (typeof sum === 'number' && plan.totalBudget > 0 &&
            Math.abs(sum - plan.totalBudget) > plan.totalBudget * BREAKDOWN_TOLERANCE) {
            errors.push(`预算明细合计 ${sum} 元与总预算 ${plan.totalBudget} 元偏差超过 10%`)
        }
    }

    // 4. 行程条目数与天数一致
    if (plan.dailyItinerary.length !== plan.days) {
        errors.push(`行程条目数（${plan.dailyItinerary.length}）与天数（${plan.days}）不一致`)
    }

    // 5. 每天至少有一个时段有安排
    for (const day of plan.dailyItinerary) {
        if (!day.morning && !day.afternoon && !day.evening) {
            errors.push(`第 ${day.day} 天没有任何行程安排`)
        }
    }

    return { valid: errors.length === 0, errors }
}
