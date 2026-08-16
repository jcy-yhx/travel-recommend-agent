<template>
    <div class="page-container">
        <div class="page-header">
            <van-nav-bar title="我的" />
        </div>
        <div class="page-content">
            <!-- 成本统计（Phase 10）：后端 /stats 聚合所有会话的真实 usage -->
            <div class="card">
                <div class="section-title">Agent 运行成本</div>
                <van-grid :column-num="2" :border="false">
                    <van-grid-item>
                        <div class="stat-value">{{ stats?.sessionCount ?? '-' }}</div>
                        <div class="stat-label">会话数</div>
                    </van-grid-item>
                    <van-grid-item>
                        <div class="stat-value">{{ stats?.requestCount ?? '-' }}</div>
                        <div class="stat-label">规划请求数</div>
                    </van-grid-item>
                    <van-grid-item>
                        <div class="stat-value">{{ formatTokens((stats?.inputTokens ?? 0) + (stats?.outputTokens ?? 0)) }}</div>
                        <div class="stat-label">累计 Token</div>
                    </van-grid-item>
                    <van-grid-item>
                        <div class="stat-value">¥{{ stats?.estimatedCost?.toFixed(4) ?? '-' }}</div>
                        <div class="stat-label">估算成本</div>
                    </van-grid-item>
                </van-grid>
                <div class="stat-note">注：仅统计行程规划请求（recommend/refine）；对话 token 因 SDK 流式限制未计入。</div>
            </div>

            <div v-if="statsError" class="error-container">
                <van-empty :description="statsError" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { onMounted, ref } from 'vue'
    import { get } from '../utils/request'

    interface Stats {
        sessionCount: number
        requestCount: number
        inputTokens: number
        outputTokens: number
        estimatedCost: number
    }

    const stats = ref<Stats | null>(null)
    const statsError = ref('')

    const formatTokens = (total?: number) => {
        if (total === undefined || total === null) return '-'
        if (total >= 10000) return (total / 1000).toFixed(1) + 'k'
        return String(total)
    }

    onMounted(async () => {
        try {
            const res = await get('stats')
            if (res && res.success !== false) {
                stats.value = res.data
            } else {
                statsError.value = res?.message || '统计加载失败'
            }
        } catch (error: any) {
            statsError.value = error.message || '统计加载失败'
        }
    })
</script>

<style scoped>
    .card {
        background-color: #fff;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 12px;
    }
    .section-title {
        font-size: 18px;
        font-weight: 600;
        color: #323233;
        margin-bottom: 12px;
    }
    .stat-value {
        font-size: 20px;
        font-weight: 600;
        color: #1989fa;
    }
    .stat-label {
        font-size: 13px;
        color: #969799;
        margin-top: 4px;
    }
    .stat-note {
        margin-top: 12px;
        font-size: 12px;
        color: #c8c9cc;
        line-height: 1.5;
    }
</style>
