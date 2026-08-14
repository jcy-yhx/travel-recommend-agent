export const createResponseStream = (res) => {
    //设置响应头
    res.setHeader('Content-Type', 'text/event-stream')
    //确保客户端每次都是接收最新的数据
    res.setHeader('Cache-Control', 'no-cache')
    //保证长链接
    res.setHeader('Connection','keep-alive')

    return {
        send:(data) => {
            try {
                res.write(`data: ${JSON.stringify(data)}\n\n`)
            } catch (error) {
                console.error('流式发送错误：', error)
            }
        },
        end: () => {
            try {
                res.write('data: {"type": "end", "message": "处理完成"}\n\n')
                res.end()                         
            } catch (error) {
                console.error('流式结束失败：', error)
            }
        },
        error: (message) => {
            try {
                res.write(`data: ${JSON.stringify({type:'error',message})}\n\n`)
                res.end()  
            } catch (error) {
                console.error('流式发送错误发送错误：', error)
            }
        }
    }

}
