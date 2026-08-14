export const createResponseStream = (res) => {
    //设置响应头
    res.setHeader('Content-Type', 'text/event-stream')
    //确保客户端每次都是接收最新的数据
    res.setHeader('Cache-Control', 'no-cache')
    //保证长链接
    res.setHeader('Connection','keep-alive')
    //立即发送响应头，让客户端马上进入流式读取状态
    res.flushHeaders()

    const write = (data) => {
        try {
            res.write(`data: ${JSON.stringify(data)}\n\n`)
        } catch (error) {
            console.error('流式发送错误：', error)
        }
    }

    return {
        //发送一个自定义事件（如 type:'chunk'）
        send: (data) => write(data),
        //正常结束：发送 done 事件并关闭连接
        done: () => {
            write({ type: 'done' })
            res.end()
        },
        //异常结束：发送 error 事件并关闭连接
        error: (message) => {
            write({ type: 'error', message })
            res.end()
        }
    }

}
