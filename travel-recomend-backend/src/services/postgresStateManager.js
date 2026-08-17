import { randomUUID } from 'node:crypto'
import { estimateCost } from '../utils/tokenStats.js'

export class PostgresStateManager {
    constructor(pool) { this.pool = pool }

    async ensureSession(sessionId) {
        const id = sessionId || randomUUID()
        await this.pool.query('INSERT INTO sessions(id) VALUES($1) ON CONFLICT (id) DO NOTHING', [id])
        return this.getSession(id)
    }

    async getSession(id) {
        const { rows } = await this.pool.query('SELECT * FROM sessions WHERE id=$1', [id])
        if (!rows[0]) return null
        const session = rows[0]
        const history = (await this.pool.query('SELECT role, content, created_at FROM messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT 20', [id])).rows.reverse()
            .map(row => ({ role: row.role, content: row.content, at: row.created_at.toISOString() }))
        return { sessionId: session.id, createdAt: session.created_at.toISOString(), updatedAt: session.updated_at.toISOString(), history, tripPlan: session.trip_plan }
    }

    async appendMessage(id, role, content) {
        await this.pool.query('INSERT INTO messages(session_id, role, content) VALUES($1,$2,$3); UPDATE sessions SET updated_at=now() WHERE id=$1', [id, role, content])
        return this.getSession(id)
    }

    async setTripPlan(id, plan) {
        const tripPlan = { city: plan.city, days: plan.days, totalBudget: plan.totalBudget, plan, updatedAt: new Date().toISOString() }
        await this.pool.query('UPDATE sessions SET trip_plan=$2, updated_at=now() WHERE id=$1', [id, tripPlan])
        return this.getSession(id)
    }

    async deleteSession(id) { return (await this.pool.query('DELETE FROM sessions WHERE id=$1', [id])).rowCount > 0 }

    async listSessions() {
        const { rows } = await this.pool.query(`SELECT s.id, s.created_at, s.updated_at, s.trip_plan,
          (SELECT count(*) FROM messages m WHERE m.session_id=s.id)::int message_count,
          (SELECT content FROM messages m WHERE m.session_id=s.id AND role='user' ORDER BY created_at DESC LIMIT 1) preview
          FROM sessions s ORDER BY s.updated_at DESC`)
        return rows.map(r => ({ sessionId: r.id, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), messageCount: r.message_count, hasPlan: Boolean(r.trip_plan?.plan), city: r.trip_plan?.city ?? null, days: r.trip_plan?.days ?? null, totalBudget: r.trip_plan?.totalBudget ?? null, preview: (r.preview ?? '').slice(0, 30) }))
    }

    async recordUsage(id, kind, usage) {
        await this.pool.query('INSERT INTO usage_logs(session_id,kind,input_tokens,output_tokens) VALUES($1,$2,$3,$4)', [id, kind, usage.inputTokens ?? 0, usage.outputTokens ?? 0])
    }

    async getStats() {
        const { rows } = await this.pool.query('SELECT (SELECT count(*) FROM sessions)::int session_count, count(*)::int request_count, coalesce(sum(input_tokens),0)::int input_tokens, coalesce(sum(output_tokens),0)::int output_tokens FROM usage_logs')
        const r = rows[0]; const usage = { inputTokens: r.input_tokens, outputTokens: r.output_tokens }
        return { sessionCount: r.session_count, requestCount: r.request_count, ...usage, estimatedCost: estimateCost(usage) }
    }
}
