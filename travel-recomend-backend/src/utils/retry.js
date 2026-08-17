export class UpstreamServiceError extends Error {
    constructor(service, cause) {
        super(`${service} 服务暂时不可用，请稍后重试`)
        this.name = 'UpstreamServiceError'
        this.code = `${service.toUpperCase()}_UNAVAILABLE`
        this.status = 503
        this.retryable = true
        this.cause = cause
    }
}

export function isTransientError(error) {
    const status = error?.status ?? error?.statusCode ?? error?.response?.status
    if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return true
    return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT']
        .includes(error?.code) || error?.name === 'AbortError'
}

export async function withRetry(operation, { maxAttempts = 2, delayMs = 200, shouldRetry = isTransientError, onRetry } = {}) {
    let lastError
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation()
        } catch (error) {
            lastError = error
            if (attempt === maxAttempts || !shouldRetry(error)) throw error
            onRetry?.(error, attempt)
            if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
        }
    }
    throw lastError
}
