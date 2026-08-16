<template>
    <div v-if="city" class="plan-context" @click="emit('view')">
        <van-notice-bar left-icon="flag-o" :scrollable="false" class="context-notice">
            当前行程：{{ city }} · {{ days }} 天 · 预算 {{ totalBudget }} 元
        </van-notice-bar>
        <span class="context-link">查看 ›</span>
    </div>
</template>

<script setup lang="ts">
    // 行程上下文横幅（Phase 11）：chat 页顶部展示会话关联的行程，
    // 点击跳转 detail 页（?sessionId 恢复行程）。无行程时不渲染。
    defineProps<{
        city: string
        days: number
        totalBudget: number
    }>()

    const emit = defineEmits<{ view: [] }>()
</script>

<style scoped>
    .plan-context {
        display: flex;
        align-items: center;
        background: #fff;
        border-bottom: 1px solid #f5f5f5;
        cursor: pointer;
    }
    .context-notice {
        flex: 1;
    }
    .context-link {
        flex-shrink: 0;
        padding: 0 16px 0 8px;
        font-size: 13px;
        color: #1989fa;
    }
</style>
