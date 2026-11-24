import { NextResponse } from 'next/server'
import { assistantActorCanReadCompanyWide, resolveAssistantActor } from '@/lib/assistant/auth'
import { verifyCrmMcpToken } from '@/lib/mcp/auth'
import { runLineTypeLookup } from '@/lib/server/line-type-lookup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

function bearerToken(request: Request): string | undefined {
  return request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || undefined
}

export async function POST(request: Request) {
  const authInfo = await verifyCrmMcpToken(request, bearerToken(request))
  const email = typeof authInfo?.extra?.email === 'string' ? authInfo.extra.email : ''
  if (!email.trim()) return json({ ok: false, error: 'CRM MCP identity is unavailable.' }, 401)

  const actor = await resolveAssistantActor(email)
  if (!actor) return json({ ok: false, error: 'CRM profile is not authorized.' }, 403)
  if (!assistantActorCanReadCompanyWide(actor)) {
    return json({ ok: false, error: 'forbidden', message: 'Company-wide access requires an owner or admin profile.' }, 403)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'invalid_request', message: 'Expected a JSON body with phones.' }, 400)
  }
  const phones = body && typeof body === 'object' && 'phones' in body
    ? (body as { phones: unknown }).phones
    : undefined

  try {
    const result = await runLineTypeLookup({ actor, phones, requestId: crypto.randomUUID() })
    return json(result.body, result.status)
  } catch (error) {
    console.error('[line-type-lookup] failed', {
      name: error instanceof Error ? error.name : 'Error',
    })
    return json({ ok: false, error: 'Line type lookup is temporarily unavailable.' }, 503)
  }
}
