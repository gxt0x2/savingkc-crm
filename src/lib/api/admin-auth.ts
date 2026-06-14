import { NextResponse } from 'next/server'
import { getCurrentUserEmail, isCurrentUserAdmin } from '@/lib/auth/admin'

const ADMIN_SECRET =
  process.env.ADMIN_API_SECRET ||
  process.env.CRON_SECRET ||
  process.env.DEPLOY_SECRET ||
  ''

function bearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function requestSecret(req: Request): string | null {
  return (
    bearerToken(req.headers.get('authorization')) ||
    req.headers.get('x-admin-secret')?.trim() ||
    null
  )
}

export function isValidAdminSecret(secret: string | null | undefined): boolean {
  return Boolean(ADMIN_SECRET && secret && secret === ADMIN_SECRET)
}

export async function requireAdminOrSecret(
  req: Request,
  extraSecrets: Array<string | null | undefined> = [],
) {
  if (isValidAdminSecret(requestSecret(req)) || extraSecrets.some(isValidAdminSecret)) {
    return null
  }

  if (await isCurrentUserAdmin()) {
    return null
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function requireUserOrSecret(
  req: Request,
  extraSecrets: Array<string | null | undefined> = [],
) {
  if (isValidAdminSecret(requestSecret(req)) || extraSecrets.some(isValidAdminSecret)) {
    return null
  }

  if (await getCurrentUserEmail()) {
    return null
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
