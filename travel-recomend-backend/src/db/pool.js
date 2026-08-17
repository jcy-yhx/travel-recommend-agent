import { Pool } from 'pg'

export function createPool(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) throw new Error('缺少 DATABASE_URL')
    return new Pool({ connectionString, max: 10, idleTimeoutMillis: 10_000 })
}
