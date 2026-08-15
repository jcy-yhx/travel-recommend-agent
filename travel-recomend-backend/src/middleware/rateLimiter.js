// 简易内存限流中间件：滑动窗口，按 IP 计数。
// 学习项目的克制方案：单进程内存实现，零依赖；
// 生产环境（多实例/高并发）应换 Redis 等共享存储的限流。
// 注意：LLM 接口是成本敏感资源，限流是第一道成本防线。

export function createRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
    const hits = new Map()   // ip → 时间戳数组（窗口内）

    return (req, res, next) => {
        const ip = req.ip || req.socket?.remoteAddress || 'unknown'
        const now = Date.now()
        const recent = (hits.get(ip) ?? []).filter(t => now - t < windowMs)

        if (recent.length >= max) {
            return res.status(429).json({
                success: false,
                message: '请求过于频繁，请稍后再试'
            })
        }
        recent.push(now)
        hits.set(ip, recent)
        next()
    }
}
