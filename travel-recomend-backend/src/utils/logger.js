// 轻量分级日志：带时间戳和级别，LOG_LEVEL 控制输出下限（debug<info<warn<error）。
// 生产环境应替换为结构化日志（pino/winston + JSON 输出），
// 本项目的规模下 console 包装足够——这是有意识的克制。

// 管道断开防护（真实踩坑，Phase 08 后修复）：
// 后端跑在终端会话里时，stdout/stderr 管道可能断开（如 Claude Code 会话
// 切换），此后的每次日志写入都会抛 EPIPE → 被 uncaughtException 兜底
// → 按设计 exit(1) → 服务在"日志写不出去"这个无关紧要的问题上反复崩溃。
// 正确策略：监听 stream 的 error 事件，日志失败静默吞掉——日志不应杀死服务。
if (process.stdout?.on) process.stdout.on('error', () => {})
if (process.stderr?.on) process.stderr.on('error', () => {})

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info

function log(level, label, args) {
    if (LEVELS[level] < currentLevel) return
    const line = `[${new Date().toISOString()}] [${label}] ${args.map(String).join(' ')}`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
}

export const logger = {
    debug: (...args) => log('debug', 'DEBUG', args),
    info: (...args) => log('info', 'INFO', args),
    warn: (...args) => log('warn', 'WARN', args),
    error: (...args) => log('error', 'ERROR', args)
}
