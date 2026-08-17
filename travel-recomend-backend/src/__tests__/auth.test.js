import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { signToken } from '../middleware/auth.js'

test('signToken 生成包含用户身份且 7 天有效期的 JWT', () => {
    process.env.JWT_SECRET = 'test-secret'
    const token = signToken({ id: 'u-1', username: 'alice' })
    const payload = jwt.verify(token, 'test-secret')
    assert.equal(payload.sub, 'u-1')
    assert.equal(payload.username, 'alice')
    assert.ok(payload.exp - payload.iat >= 6 * 24 * 60 * 60)
})
