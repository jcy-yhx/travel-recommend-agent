<template>
    <div class="trace-panel">
        <van-steps direction="vertical" :active="events.length - 1" active-color="#1989fa">
            <van-step v-for="event in events" :key="event.seq">
                <div class="trace-step">
                    <div class="trace-title">
                        <van-tag :type="tagType(event)" size="medium">{{ labelOf(event.node) }}</van-tag>
                        <span class="trace-summary">{{ summaryOf(event) }}</span>
                    </div>
                    <van-collapse v-if="hasDetail(event)" v-model="expanded" class="trace-detail">
                        <van-collapse-item :name="String(event.seq)" title="查看详情">
                            <pre class="trace-pre">{{ detailOf(event) }}</pre>
                        </van-collapse-item>
                    </van-collapse>
                </div>
            </van-step>
        </van-steps>
        <div v-if="running" class="trace-running">
            <van-loading size="16px" color="#1989fa" vertical>Agent 思考中…</van-loading>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { ref } from 'vue'

    // 轨迹事件：后端 traceEvents.js 整形后经 SSE 推送
    interface TraceEvent {
        type: 'node'
        seq: number
        node: string
        data: Record<string, any>
    }

    defineProps<{
        events: TraceEvent[]
        running: boolean
    }>()

    const expanded = ref<string[]>([])

    const NODE_LABELS: Record<string, string> = {
        agent: 'Agent 决策',
        tools: '工具执行',
        planner: '行程大纲',
        executor: '行程生成',
        validator: '预算校验',
        replan_feedback: '修正反馈'
    }

    const labelOf = (node: string) => NODE_LABELS[node] ?? node

    const tagType = (event: TraceEvent) => {
        if (event.node === 'tools' && event.data.results?.some((r: any) => r.hasError)) return 'warning'
        if (event.node === 'validator' && !event.data.valid) return 'danger'
        if (event.node === 'planner' && event.data.degraded) return 'warning'
        if (event.node === 'replan_feedback') return 'warning'
        return 'primary'
    }

    const summaryOf = (event: TraceEvent) => {
        switch (event.node) {
            case 'agent': {
                const d = event.data
                if (d.stopped) return `第 ${d.iteration} 轮：信息足够，停止搜索`
                const names = d.toolCalls?.map((t: any) => t.name).join('、')
                return `第 ${d.iteration} 轮：请求调用 ${names}`
            }
            case 'tools':
                return `${event.data.results?.length ?? 0} 个工具结果返回`
            case 'planner':
                return event.data.degraded ? '大纲生成失败，降级跳过' : '大纲已锁定（主题 / 景点 / 预算）'
            case 'executor':
                return '完整行程已生成'
            case 'validator':
                return event.data.valid ? '5 条规则全部通过' : `${event.data.errors?.length ?? 0} 条规则未通过`
            case 'replan_feedback':
                return '校验错误反馈，重新生成一次'
            default:
                return ''
        }
    }

    const hasDetail = (event: TraceEvent) =>
        event.node === 'tools' || event.node === 'validator' || event.node === 'replan_feedback'

    const detailOf = (event: TraceEvent) => {
        if (event.node === 'tools') {
            return event.data.results
                ?.map((r: any) => (r.hasError ? '[失败] ' : '') + r.preview)
                .join('\n\n') ?? ''
        }
        if (event.node === 'validator' || event.node === 'replan_feedback') {
            return (event.data.errors ?? []).join('\n')
        }
        return ''
    }
</script>

<style scoped>
    .trace-panel {
        background: #fff;
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 12px;
    }
    .trace-step {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .trace-title {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .trace-summary {
        font-size: 13px;
        color: #646566;
    }
    .trace-detail {
        margin-top: 4px;
    }
    .trace-pre {
        white-space: pre-wrap;
        word-break: break-all;
        font-size: 12px;
        color: #666;
        margin: 0;
        max-height: 200px;
        overflow-y: auto;
    }
    .trace-running {
        padding: 12px 0 0;
        text-align: center;
    }
</style>
