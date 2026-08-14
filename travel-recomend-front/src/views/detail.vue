<template>
    <div class="page-container">
        <div class="page-header">
            <van-nav-bar fixed left-text="返回" left-arrow @click-left="onBack" :title="formData.city ? formData.city + '行程规划' : '行程规划'"/>
        </div>
        <div class="page-content">
            <div v-if="isLoading" class="loading-container">
                <van-loading size="48px" type="spinner">
                    正在生成旅游规划...
                </van-loading>
            </div>
            <div v-else-if="errMessage" class="error-container">
                <van-empty :description="errMessage" >
                    <van-button type="primary" @click="fetchTripData">重新规划</van-button>
                </van-empty>
            </div>
            <template v-else-if="tripData && tripData.success !== false">
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
            </template>
        </div>
    </div>

</template>

<script setup lang="ts">
    import { onMounted, reactive, ref } from 'vue';
    import { useRouter, useRoute } from 'vue-router';
    import { post } from '../utils/request'

    // 与后端 prompt 中约定的 JSON 结构保持一致
    interface TripSegment {
        spot: string
        duration: string
        ticket: string
        transportation: string
        description: string
    }

    interface TripData {
        success: boolean
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

    const formData = reactive({
        city: '',
        budget: null as number | null,
        days: null as number | null
    })

    const fetchTripData = async () => {
        isLoading.value = true
        errMessage.value = ''
        try {
            const res = await post('recommend', {
                city: formData.city,
                budget: Number(formData.budget),
                days: Number(formData.days)
            })
            if (res && res.success !== false) {
                tripData.value = res.data
            } else {
                errMessage.value = res?.message || '接口调用失败'
                tripData.value = null
            }
        } catch (error: any) {
            console.error('请求失败:', error)
            if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
                errMessage.value = '请求超时，请检查网络或稍后重试'
            } else if (error.response?.data?.message) {
                errMessage.value = error.response.data.message
            } else {
                errMessage.value = error.message || '接口调用失败'
            }
            tripData.value = null
        } finally {
            isLoading.value = false
        }
    }

    onMounted(() => {
        formData.city = (route.query.city as string) || ''
        formData.budget = route.query.budget ? Number(route.query.budget) : null
        formData.days = route.query.days ? Number(route.query.days) : null
        if (formData.city && formData.budget && formData.days) {
            fetchTripData()
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
    padding: 12px 16px;
    background: #fff;
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.05);
    max-width: 750px;
    margin: 0 auto;
    }

    .error-card {
    text-align: center;
    padding: 40px 16px;
    }
</style>
