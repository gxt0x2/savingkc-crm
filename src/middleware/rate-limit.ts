/**
 * SEC-02: Rate Limiting Middleware
 * In-memory rate limiting for API endpoints
 * TODO: Replace with Redis-based solution for production
 */

interface RateLimitStore {
  [key: string]: {
    count: number
    resetTime: number
  }
}

const store: RateLimitStore = {}

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  Object.keys(store).forEach((key) => {
    if (store[key].resetTime < now) {
      delete store[key]
    }
  })
}, 5 * 60 * 1000)

export interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

export const rateLimitConfigs = {
  general: { maxRequests: 100, windowMs: 60000 }, // 100 per minute
  auth: { maxRequests: 10, windowMs: 60000 }, // 10 per minute
  webhook: { maxRequests: 60, windowMs: 60000 }, // 60 per minute
  publicForm: { maxRequests: 20, windowMs: 60000 }, // 20 per minute
}

export function rateLimit(ip: string, config: RateLimitConfig): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const key = `${ip}:${config.windowMs}`

  // Initialize or check if window has expired
  if (!store[key] || store[key].resetTime < now) {
    store[key] = {
      count: 1,
      resetTime: now + config.windowMs,
    }
    return { allowed: true, remaining: config.maxRequests - 1 }
  }

  // Increment count
  store[key].count++

  // Check if limit exceeded
  if (store[key].count > config.maxRequests) {
    return { allowed: false, remaining: 0 }
  }

  return { allowed: true, remaining: config.maxRequests - store[key].count }
}

export function getClientIp(request: Request): string {
  // Check common headers for client IP
  const headers = request.headers
  const forwarded = headers.get('x-forwarded-for')
  const realIp = headers.get('x-real-ip')
  const cfConnectingIp = headers.get('cf-connecting-ip')

  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  if (realIp) {
    return realIp
  }
  if (cfConnectingIp) {
    return cfConnectingIp
  }

  // Fallback (won't work in production behind proxy)
  return 'unknown'
}
