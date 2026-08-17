import jwt from 'jsonwebtoken'

const secret = () => process.env.JWT_SECRET || 'dev-only-change-me'

export function signToken(user) {
    return jwt.sign({ sub: user.id, username: user.username }, secret(), { expiresIn: '7d' })
}

export function requireAuth(req, res, next) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ success: false, message: '请先登录' })
    try {
        const payload = jwt.verify(token, secret())
        req.user = { id: payload.sub, username: payload.username }
        next()
    } catch {
        return res.status(401).json({ success: false, message: '登录已失效，请重新登录' })
    }
}
