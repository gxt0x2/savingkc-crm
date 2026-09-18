import { NextRequest, NextResponse } from 'next/server'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileActor } from '@/lib/mobile-api/auth'
import { transitionWorkItem, WorkItemError } from '@/lib/server/work-items'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireMobileActor(req)
    const { id } = await params
    const key = req.headers.get('idempotency-key')?.trim() || ''
    if (key.length < 8 || key.length > 200) return NextResponse.json({ error: 'A stable Idempotency-Key is required' }, { status: 400, headers: mobileNoStoreHeaders() })
    const body = await req.json().catch(() => ({})) as { expectedVersion?: unknown }
    const result = await transitionWorkItem({ key: id, actor: actor.name, action: 'reopen', idempotencyKey: key, expectedVersion: typeof body.expectedVersion === 'number' ? body.expectedVersion : null })
    return NextResponse.json({ success: true, changed: result.changed, item: result.workItem }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    if (error instanceof MobileAuthError) return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
    if (error instanceof WorkItemError) return NextResponse.json({ error: error.message }, { status: error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : error.code === 'invalid' ? 400 : 503, headers: mobileNoStoreHeaders() })
    return NextResponse.json({ error: 'Work item could not be reopened.' }, { status: 503, headers: mobileNoStoreHeaders() })
  }
}
