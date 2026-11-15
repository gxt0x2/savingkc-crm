import { createHash, timingSafeEqual } from 'node:crypto'
import { prospectingJson } from '@/lib/api/prospecting-response'
import { ingestForeclosureBatch } from '@/lib/server/foreclosure-intake'
import { ForeclosureError } from '@/lib/server/foreclosure-prospects'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function foreclosureError(error: unknown) {
  if (error instanceof ForeclosureError) return prospectingJson({ error: error.message, code: error.code }, { status: error.status })
  console.error('[foreclosure] intake failed', error)
  return prospectingJson({ error: 'Foreclosure intake is unavailable.', code: 'foreclosure_unavailable' }, { status: 503 })
}

function secretMatches(authorization: string | null, secret: string | undefined): boolean {
  const supplied = authorization?.match(/^Bearer\s+(\S+)\s*$/i)?.[1]
  const configured = secret?.trim()
  if (!configured || !supplied || supplied.length > 1024) return false
  const left = createHash('sha256').update(configured).digest()
  const right = createHash('sha256').update(supplied).digest()
  return timingSafeEqual(left, right)
}

export async function POST(request: Request) {
  const secret = process.env.FORECLOSURE_INTAKE_SECRET
  if (!secret?.trim()) {
    return prospectingJson({ error: 'Foreclosure intake is not configured.', code: 'intake_unconfigured' }, { status: 503 })
  }
  if (!secretMatches(request.headers.get('authorization'), secret)) {
    return prospectingJson({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })
  }
  try {
    const body = await request.json() as unknown
    return prospectingJson(await ingestForeclosureBatch(body))
  } catch (error) {
    return foreclosureError(error)
  }
}
