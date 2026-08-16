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

            <!-- 会话历史（Phase 11）：列表 + 右滑删除 + 点击恢复对话 -->
            <div class="card">
                <div class="section-title">会话历史</div>
                <van-cell-group v-if="sessions.length" inset>
                    <van-swipe-cell v-for="s in sessions" :key="s.sessionId">
                        <van-cell
                            is-link
                            :title="s.city ? `${s.city} · ${s.days} 天 · ¥${s.totalBudget}` : '对话会话'"
                            :label="labelOf(s)"
                            @click="openSession(s)"
                        />
                        <template #right>
                            <van-button square type="danger" text="删除" class="swipe-delete" @click="confirmDelete(s)" />
                        </template>
                    </van-swipe-cell>
                </van-cell-group>
                <van-empty v-else description="还没有会话，先去规划一次行程吧" image-size="80" />
                <div class="session-note">点击会话可恢复对话历史；有行程的会话可查看与修改行程。</div>
            </div>

            <div v-if="sessionsError" class="error-container">
                <van-empty :description="sessionsError" />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { onMounted, ref } from 'vue'
    import { useRouter } from 'vue-router'
    import { showConfirmDialog } from 'vant'
    import { get, del } from '../utils/request'

    interface Stats {
        sessionCount: number
        requestCount: number
        inputTokens: number
        outputTokens: number
        estimatedCost: number
    }

    // 与后端 stateManager.listSessions 返回的元数据保持一致
    interface SessionMeta {
        sessionId: string
        createdAt: string
        updatedAt: string
        messageCount: number
        hasPlan: boolean
        city: string | null
        days: number | null
        totalBudget: number | null
        preview: string
    }

    const router = useRouter()

    const stats = ref<Stats | null>(null)
    const statsError = ref('')
    const sessions = ref<SessionMeta[]>([])
    const sessionsError = ref('')

    const formatTokens = (total?: number) => {
        if (total === undefined || total === null) return '-'
        if (total >= 10000) return (total / 1000).toFixed(1) + 'k'
        return String(total)
    }

    const formatTime = (iso: string) => {
        const d = new Date(iso)
        const pad = (n: number) => String(n).padStart(2, '0')
        return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    const labelOf = (s: SessionMeta) => {
        const parts = [`${s.messageCount} 条消息`, formatTime(s.updatedAt)]
        if (s.preview) parts.unshift(s.preview)
        return parts.join(' · ')
    }

    // 点击会话 → chat 页恢复历史（restore=1），横幅展示该会话的行程
    const openSession = (s: SessionMeta) => {
        router.push({ path: '/chat', query: { sessionId: s.sessionId, restore: '1' } })
    }

    const confirmDelete = (s: SessionMeta) => {
        showConfirmDialog({
            title: '删除会话',
            message: `确定删除「${s.city ? s.city + ' 行程' : '对话会话'}」吗？删除后不可恢复。`
        })
            .then(async () => {
                await del(`sessions/${s.sessionId}`)
                loadSessions()
            })
            .catch(() => { /* 用户取消 */ })
    }

    const loadSessions = async () => {
        try {
            const res = await get('sessions')
            sessions.value = res?.data ?? []
        } catch (error: any) {
            sessionsError.value = error.message || '会话列表加载失败'
        }
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
        loadSessions()
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
    .swipe-delete {
        height: 100%;
    }
    .session-note {
        margin-top: 12px;
        font-size: 12px;
        color: #c8c9cc;
        line-height: 1.5;
    }
</style>
