<template>
    <div class="page-container chat-page">
        <div class="page-header">
            <van-nav-bar title="AI 旅游助手" />
        </div>
        <div ref="msgListEl" class="page-content chat-content">
            <div v-for="(msg, index) in messages" :key="index" class="msg-row" :class="msg.role">
                <div class="msg-bubble">{{ msg.content }}</div>
            </div>
            <div v-if="streaming" class="msg-row assistant">
                <div class="msg-bubble"><span class="streaming-cursor">▍</span></div>
            </div>
        </div>
        <div class="chat-input">
            <van-field
                v-model="inputText"
                placeholder="问我任何旅游相关的问题"
                :disabled="streaming"
                @keyup.enter="handleSend"
            />
            <van-button type="primary" size="small" :disabled="streaming" @click="handleSend">发送</van-button>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { nextTick, ref, watch } from 'vue'
    import { streamPost } from '../utils/sse'

    interface ChatMessage {
        role: 'user' | 'assistant'
        content: string
    }

    const messages = ref<ChatMessage[]>([])
    const inputText = ref('')
    const streaming = ref(false)
    const msgListEl = ref<HTMLElement | null>(null)

    // 会话 ID：存在 localStorage，让同一浏览器里的所有请求共享一个会话
    // （聊天多轮记忆 + 行程草案上下文都靠它关联）
    const sessionId = localStorage.getItem('travel_session_id') || ''

    // 新消息（含流式追加）到来时滚动到底部
    watch(messages, async () => {
        await nextTick()
        msgListEl.value?.scrollTo({ top: msgListEl.value.scrollHeight })
    }, { deep: true })

    const handleSend = async () => {
        const text = inputText.value.trim()
        if (!text || streaming.value) return

        messages.value.push({ role: 'user', content: text })
        inputText.value = ''
        streaming.value = true

        // 先放入空回复，流式 chunk 逐个追加进去
        const assistantMsg = { role: 'assistant' as const, content: '' }
        messages.value.push(assistantMsg)

        try {
            // 通用 SSE 消费（utils/sse.ts）：chunk 追加 / done 存会话 ID / error 抛错
            await streamPost('chat', { message: text, sessionId: sessionId || undefined }, (event) => {
                if (event.type === 'chunk') {
                    assistantMsg.content += event.content
                } else if (event.type === 'error') {
                    throw new Error(event.message || '对话失败')
                } else if (event.type === 'done' && event.sessionId) {
                    localStorage.setItem('travel_session_id', event.sessionId)
                }
            })
        } catch (error: any) {
            assistantMsg.content = assistantMsg.content || `对话失败：${error.message}`
        } finally {
            streaming.value = false
        }
    }
</script>

<style scoped>
    .chat-page {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
    }
    .chat-content {
        flex: 1;
        padding-bottom: 70px;
    }
    .chat-input {
        position: fixed;
        bottom: 50px;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #fff;
        border-top: 1px solid #f0f0f0;
        max-width: 750px;
        margin: 0 auto;
    }
    .chat-input .van-field {
        flex: 1;
        background: #f7f8fa;
        border-radius: 8px;
    }
    .msg-row {
        display: flex;
        margin-bottom: 12px;
    }
    .msg-row.user {
        justify-content: flex-end;
    }
    .msg-row.assistant {
        justify-content: flex-start;
    }
    .msg-bubble {
        max-width: 75%;
        padding: 10px 14px;
        border-radius: 12px;
        font-size: 14px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
    }
    .user .msg-bubble {
        background: #1989fa;
        color: #fff;
        border-bottom-right-radius: 4px;
    }
    .assistant .msg-bubble {
        background: #fff;
        color: #323233;
        border-bottom-left-radius: 4px;
    }
</style>
