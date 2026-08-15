// 轻量分级日志：带时间戳和级别，LOG_LEVEL 控制输出下限（debug<info<warn<error）。
// 生产环境应替换为结构化日志（pino/winston + JSON 输出），
// 本项目的规模下 console 包装足够——这是有意识的克制。

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
