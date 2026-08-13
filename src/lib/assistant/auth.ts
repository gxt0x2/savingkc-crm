import { timingSafeEqual } from 'node:crypto'

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function bearerToken(request: Request): string | null {
  return request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null
}

export function authorizeAssistantRequest(request: Request): { email: string } | null {
  const configuredSecret = process.env.CRM_ASSISTANT_API_SECRET?.trim()
  const suppliedSecret = bearerToken(request)
  if (!configuredSecret || !suppliedSecret || !safeEqual(configuredSecret, suppliedSecret)) return null

  const email = request.headers.get('x-savingkc-user-email')?.trim().toLowerCase()
  if (!email) return null

  const allowedEmails = new Set(
    (process.env.CRM_ASSISTANT_ALLOWED_EMAILS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )

  return allowedEmails.has(email) ? { email } : null
}
