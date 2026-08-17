import express from 'express'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { createPool } from '../db/pool.js'
import { signToken } from '../middleware/auth.js'
import { asyncHandler } from '../utils/asyncHandler.js'

const router = express.Router()
const pool = createPool()
const validUsername = value => /^[A-Za-z0-9_]{3,32}$/.test(String(value ?? ''))

router.post('/register', asyncHandler(async (req, res) => {
    const { username, password } = req.body
    if (!validUsername(username) || String(password ?? '').length < 8 || String(password).length > 72) {
        return res.status(400).json({ success: false, message: '用户名为3-32位字母、数字或下划线；密码为8-72位' })
    }
    const user = { id: randomUUID(), username: String(username) }
    try {
        await pool.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)', [user.id, user.username, await bcrypt.hash(password, 12)])
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ success: false, message: '用户名已存在' })
        throw error
    }
    return res.status(201).json({ success: true, data: { token: signToken(user), user: { id: user.id, username: user.username } } })
}))

router.post('/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body
    const { rows } = await pool.query('SELECT id,username,password_hash FROM users WHERE username=$1', [String(username ?? '')])
    const user = rows[0]
    if (!user || !await bcrypt.compare(String(password ?? ''), user.password_hash)) {
        return res.status(401).json({ success: false, message: '用户名或密码错误' })
    }
    return res.json({ success: true, data: { token: signToken(user), user: { id: user.id, username: user.username } } })
}))

export default router
