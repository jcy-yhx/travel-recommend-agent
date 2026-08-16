// 通用 SSE 流式 POST（从 chat.vue 的手写解析器提取，Phase 10 起
// recommend/stream、refine、chat 三类流式端点共用这一份）。
// 用原生 fetch + ReadableStream 消费（EventSource 只支持 GET，不能带 body）。

import { BASE_URL } from './request'

export async function streamPost(
    url: string,
    body: unknown,
    onEvent: (event: Record<string, any>) => void
): Promise<void> {
    const res = await fetch(`${BASE_URL}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })

    if (!res.ok || !res.body) {
        // 非 2xx（400 参数 / 429 限流 / 500）时尽量取后端的 message
        let message = `请求失败（${res.status}）`
        try {
            const data = await res.json()
            if (data?.message) message = data.message
        } catch { /* 无 JSON body 时用默认文案 */ }
        throw new Error(message)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE 事件以空行分隔；最后一段可能不完整，留在 buffer 等下一次
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
            const dataLine = part.split('\n').find(line => line.startsWith('data: '))
            if (!dataLine) continue
            onEvent(JSON.parse(dataLine.slice(6)))
        }
    }
}
