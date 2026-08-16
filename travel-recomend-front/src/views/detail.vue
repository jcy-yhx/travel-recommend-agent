<template>
    <div class="page-container">
        <div class="page-header">
            <van-nav-bar fixed left-text="返回" left-arrow @click-left="onBack" :title="formData.city ? formData.city + '行程规划' : '行程规划'"/>
        </div>
        <div class="page-content">
            <!-- 生成/修改过程：Agent 执行轨迹实时可见（面试展示主场景） -->
            <TracePanel v-if="traceRunning || traceEvents.length" :events="traceEvents" :running="traceRunning" />
            <div v-if="traceRunning && !traceEvents.length && !tripData" class="loading-container">
                <van-loading size="48px" type="spinner">
                    正在启动 Agent...
                </van-loading>
            </div>
            <!-- 错误卡片独立 v-if（不挂在 v-else-if 链上）：
                 修改行程失败时旧行程仍可看，错误在上方提示 -->
            <div v-if="errMessage" class="error-container">
                <van-empty :description="errMessage" >
                    <van-button type="primary" @click="fetchTripData">重新规划</van-button>
                </van-empty>
            </div>
            <template v-if="tripData">
                <!-- 概览 -->
                <div class="card overview-card">
                    <div class="trip-header">
                        <h2>{{tripData.city}} · {{tripData.days}}天行程规划</h2>
                        <div class="trip-budget">预算：{{ tripData.totalBudget }}元</div>
                    </div>
                </div>

                <!-- 每日行程 -->
                <div v-for="day in tripData.dailyItinerary" :key="day.day" class="card trip-collapse">
                    <div class="section-title">第{{ day.day }}天 · {{ day.date }}</div>
                    <div class="day-schedule">
                        <div v-if="day.morning && day.morning.spot" class="schedule-section">
                            <span class="section-label morning">上午</span>
                            <div class="schedule-spot">{{ day.morning.spot }}（{{ day.morning.duration }}）</div>
                            <div class="schedule-desc">{{ day.morning.description }}</div>
                            <div class="schedule-meta">门票：{{ day.morning.ticket }} · 交通：{{ day.morning.transportation }}</div>
                        </div>
                        <div v-if="day.afternoon && day.afternoon.spot" class="schedule-section">
                            <span class="section-label afternoon">下午</span>
                            <div class="schedule-spot">{{ day.afternoon.spot }}（{{ day.afternoon.duration }}）</div>
                            <div class="schedule-desc">{{ day.afternoon.description }}</div>
                            <div class="schedule-meta">门票：{{ day.afternoon.ticket }} · 交通：{{ day.afternoon.transportation }}</div>
                        </div>
                        <div v-if="day.evening && day.evening.spot" class="schedule-section">
                            <span class="section-label evening">晚上</span>
                            <div class="schedule-spot">{{ day.evening.spot }}（{{ day.evening.duration }}）</div>
                            <div class="schedule-desc">{{ day.evening.description }}</div>
                            <div class="schedule-meta">门票：{{ day.evening.ticket }} · 交通：{{ day.evening.transportation }}</div>
                        </div>
                    </div>
                </div>

                <!-- 预算明细 -->
                <div v-if="tripData.budgetBreakdown" class="card budget-card">
                    <div class="section-title">预算分配</div>
                    <van-cell-group inset>
                        <van-cell title="住宿" :value="tripData.budgetBreakdown.accommodation + ' 元'" />
                        <van-cell title="餐饮" :value="tripData.budgetBreakdown.food + ' 元'" />
                        <van-cell title="交通" :value="tripData.budgetBreakdown.transportation + ' 元'" />
                        <van-cell title="门票" :value="tripData.budgetBreakdown.tickets + ' 元'" />
                        <van-cell title="其他" :value="tripData.budgetBreakdown.other + ' 元'" />
                    </van-cell-group>
                </div>

                <!-- 旅行提示 -->
                <div v-if="tripData.tips && tripData.tips.length" class="card tips-card">
                    <div class="section-title">旅行提示</div>
                    <ul class="tips-list">
                        <li v-for="(tip, index) in tripData.tips" :key="index">{{ tip }}</li>
                    </ul>
                </div>

                <!-- 注意事项 -->
                <div v-if="tripData.warnings && tripData.warnings.length" class="card warnings-card">
                    <div class="section-title">注意事项</div>
                    <ul class="warnings-list">
                        <li v-for="(warning, index) in tripData.warnings" :key="index">{{ warning }}</li>
                    </ul>
                </div>

                <!-- 本次请求成本（后端真实统计） -->
                <div v-if="usage" class="card usage-card">
                    <div class="section-title">本次请求成本</div>
                    <div class="usage-line">Token：输入 {{ usage.inputTokens }} + 输出 {{ usage.outputTokens }}，估算成本 ¥{{ usage.estimatedCost.toFixed(4) }}</div>
                </div>
            </template>
        </div>

        <!-- 底部操作栏（Phase 11）：追问（chat 只回答）vs 修改（refine 重跑图） -->
        <div v-if="tripData" class="detail-footer">
            <van-button plain type="primary" @click="goChat">追问行程</van-button>
            <van-button type="primary" :disabled="refineRunning" @click="showRefine = true">修改行程</van-button>
        </div>

        <!-- 修改行程指令输入（Phase 11）：快捷模板 + 自由输入，走 /refine 重跑图 -->
        <van-action-sheet v-model:show="showRefine" title="修改行程">
            <div class="refine-sheet">
                <div class="refine-templates">
                    <span class="refine-templates-label">快捷指令：</span>
                    <van-tag
                        v-for="t in REFINE_TEMPLATES"
                        :key="t"
                        class="refine-tag"
                        plain
                        type="primary"
                        size="medium"
                        @click="refineText = t"
                    >{{ t }}</van-tag>
                </div>
                <van-field
                    v-model="refineText"
                    rows="2"
                    autosize
                    type="textarea"
                    maxlength="200"
                    show-word-limit
                    placeholder="描述你想怎么改，例如：把第二天改成西湖"
                />
                <div class="refine-submit">
                    <van-button type="primary" block :loading="refineRunning" :disabled="!refineText.trim()" @click="submitRefine">
                        开始修改（重新规划）
                    </van-button>
                </div>
            </div>
        </van-action-sheet>
    </div>

</template>

<script setup lang="ts">
    import { onMounted, reactive, ref } from 'vue';
    import { useRouter, useRoute } from 'vue-router';
    import { streamPost } from '../utils/sse'
    import { get } from '../utils/request'
    import TracePanel from '../components/TracePanel.vue'

    // 与后端 prompt 中约定的 JSON 结构保持一致
    interface TripSegment {
        spot: string
        duration: string
        ticket: string
        transportation: string
        description: string
    }

    interface TripData {
        city: string
        days: number
        totalBudget: number
        dailyItinerary: Array<{
            day: number
            date: string
            morning?: TripSegment
            afternoon?: TripSegment
            evening?: TripSegment
        }>
        budgetBreakdown?: {
            accommodation: number
            food: number
            transportation: number
            tickets: number
            other: number
        }
        tips?: string[]
        warnings?: string[]
    }

    const router = useRouter()
    const route = useRoute()

    //加载状态
    const isLoading = ref(false)
    const errMessage = ref('')
    const tripData = ref<TripData | null>(null)

    // Agent 执行轨迹（Phase 10）：后端 SSE 实时推送的节点事件
    interface TraceEvent { type: 'node'; seq: number; node: string; data: Record<string, any> }
    const traceEvents = ref<TraceEvent[]>([])
    const traceRunning = ref(false)
    const usage = ref<{ inputTokens: number; outputTokens: number; estimatedCost: number } | null>(null)

    // 会话 ID：localStorage 与 URL（?sessionId）共用一套，
    // 规划/修改都携带它，行程才会关联到同一个会话
    const sessionId = ref((route.query.sessionId as string) || localStorage.getItem('travel_session_id') || '')

    // 修改行程（Phase 11）：指令弹层状态
    const showRefine = ref(false)
    const refineText = ref('')
    const refineRunning = ref(false)
    // 快捷模板：全部遵守后端 refine 约束（天数不变、预算只降不升）
    const REFINE_TEMPLATES = ['把第二天改成西湖', '把预算压缩 20%', '增加一个夜游项目']

    const formData = reactive({
        city: '',
        budget: null as number | null,
        days: null as number | null
    })

    // 流式结束（done / error）时轨迹已完成使命：
    // 清空事件列表，时间线替换为行程卡片（phase-10.md 的设计：done 替换为行程）
    const fetchTripData = async () => {
        isLoading.value = true
        errMessage.value = ''
        traceEvents.value = []
        usage.value = null
        try {
            // 流式规划：Agent 执行轨迹实时推送（携带会话 ID 关联行程）
            traceRunning.value = true
            await streamPost('recommend/stream', {
                city: formData.city,
                budget: Number(formData.budget),
                days: Number(formData.days),
                sessionId: sessionId.value || undefined
            }, (event) => {
                if (event.type === 'node') {
                    traceEvents.value.push(event as TraceEvent)
                } else if (event.type === 'done') {
                    tripData.value = event.plan
                    usage.value = event.usage ?? null
                    if (event.sessionId) {
                        sessionId.value = event.sessionId
                        localStorage.setItem('travel_session_id', event.sessionId)
                    }
                    traceEvents.value = []
                } else if (event.type === 'error') {
                    throw new Error(event.message || '规划失败')
                }
            })
        } catch (error: any) {
            console.error('请求失败:', error)
            if (error.message?.includes('timeout')) {
                errMessage.value = '请求超时，请检查网络或稍后重试'
            } else {
                errMessage.value = error.message || '接口调用失败'
            }
            tripData.value = null
        } finally {
            isLoading.value = false
            traceRunning.value = false
        }
    }

    // 提交修改指令：与规划共用同一条流式链路（轨迹面板重放 → done 替换行程）
    const submitRefine = async () => {
        const instruction = refineText.value.trim()
        if (!instruction || refineRunning.value) return
        if (!sessionId.value) {
            errMessage.value = '缺少会话信息，请先规划一次行程'
            return
        }

        showRefine.value = false
        refineRunning.value = true
        errMessage.value = ''
        traceEvents.value = []
        usage.value = null
        try {
            traceRunning.value = true
            await streamPost('refine', {
                sessionId: sessionId.value,
                instruction
            }, (event) => {
                if (event.type === 'node') {
                    traceEvents.value.push(event as TraceEvent)
                } else if (event.type === 'done') {
                    tripData.value = event.plan
                    usage.value = event.usage ?? null
                    traceEvents.value = []
                } else if (event.type === 'error') {
                    throw new Error(event.message || '修改失败')
                }
            })
        } catch (error: any) {
            console.error('修改行程失败:', error)
            errMessage.value = error.message || '修改失败'
            // 修改失败：旧行程仍保留展示（tripData 不动）
        } finally {
            traceRunning.value = false
            refineRunning.value = false
            refineText.value = ''
        }
    }

    // 追问行程：跳 chat（同会话，横幅展示当前行程；chat 只回答、不修改）
    const goChat = () => {
        router.push({ path: '/chat' })
    }

    // 从会话恢复行程（profile/chat 跳转入口）：
    // 有完整行程直接展示；Phase 11 前的旧会话只有概要 → 按概要重新生成
    const restoreFromSession = async (sid: string) => {
        try {
            const res = await get(`sessions/${sid}`)
            const session = res?.data
            if (!session?.tripPlan) {
                errMessage.value = '该会话没有行程记录'
                return
            }
            if (session.tripPlan.plan) {
                tripData.value = session.tripPlan.plan
                sessionId.value = sid
                localStorage.setItem('travel_session_id', sid)
            } else {
                formData.city = session.tripPlan.city
                formData.budget = session.tripPlan.totalBudget
                formData.days = session.tripPlan.days
                fetchTripData()
            }
        } catch (error: any) {
            console.error('会话恢复失败:', error)
            errMessage.value = error.message || '会话加载失败'
        }
    }

    onMounted(() => {
        formData.city = (route.query.city as string) || ''
        formData.budget = route.query.budget ? Number(route.query.budget) : null
        formData.days = route.query.days ? Number(route.query.days) : null
        if (formData.city && formData.budget && formData.days) {
            fetchTripData()
        } else if (route.query.sessionId) {
            // 无规划参数、带 sessionId：从会话恢复行程（无 plan 则按概要重新生成）
            restoreFromSession(route.query.sessionId as string)
        }
    })

    const onBack = () => {
        router.back()
    }
</script>

<style scoped>
    .page-header {
        height: 46px;
    }
    .page-container {
        min-height: 100vh;
        background-color: #f5f5f5;
        padding-bottom: 70px;
    }
    .card {
        background-color: #fff;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }
    .section-title {
        font-size: 18px;
        font-weight: 600;
        color: #323233;
        margin-bottom: 12px;
    }
    .page-content {
        padding: 16px;
    }
    .overview-card {
    margin-bottom: 16px;
    }

    .trip-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    }

    .trip-header h2 {
    font-size: 20px;
    color: #323233;
    margin: 0;
    }

    .trip-budget {
    font-size: 16px;
    color: #ee0a24;
    font-weight: 600;
    }

    .trip-collapse {
    margin-bottom: 16px;
    }

    .day-schedule {
    padding: 8px 0;
    }

    .schedule-section {
    margin-bottom: 16px;
    }

    .schedule-section:last-child {
    margin-bottom: 0;
    }

    .schedule-spot {
    font-size: 15px;
    font-weight: 600;
    color: #323233;
    margin-bottom: 4px;
    }

    .schedule-desc {
    font-size: 14px;
    color: #666;
    margin-bottom: 4px;
    }

    .schedule-meta {
    font-size: 13px;
    color: #999;
    }

    .section-label {
    font-size: 14px;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 4px;
    display: inline-block;
    margin-bottom: 8px;
    }

    .section-label.morning {
    background: #fff7e6;
    color: #fa8c16;
    }

    .section-label.afternoon {
    background: #e6f7ff;
    color: #1890ff;
    }

    .section-label.evening {
    background: #f6ffed;
    color: #52c41a;
    }

    .budget-card,
    .tips-card,
    .warnings-card {
    margin-bottom: 16px;
    }

    .tips-list,
    .warnings-list {
    list-style: none;
    padding: 0;
    margin: 0;
    }

    .tips-list li,
    .warnings-list li {
    padding: 8px 0;
    color: #666;
    font-size: 14px;
    border-bottom: 1px solid #f5f5f5;
    }

    .tips-list li:last-child,
    .warnings-list li:last-child {
    border-bottom: none;
    }

    .detail-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    gap: 12px;
    padding: 12px 16px;
    background: #fff;
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
    max-width: 750px;
    margin: 0 auto;
    }

    .detail-footer .van-button {
    flex: 1;
    }

    .refine-sheet {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    }

    .refine-templates {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    }

    .refine-templates-label {
    font-size: 13px;
    color: #646566;
    }

    .refine-tag {
    cursor: pointer;
    }

    .refine-submit {
    padding-bottom: 8px;
    }

    .error-card {
    text-align: center;
    padding: 40px 16px;
    }

    .usage-card .usage-line {
    font-size: 13px;
    color: #999;
    }
</style>
