import { NextRequest, NextResponse } from 'next/server'
import {
  MobileAuthError,
  mobileNoStoreHeaders,
  mobileOptionsResponse,
  requireMobileActor,
} from '@/lib/mobile-api/auth'
import { transitionWorkItem, WorkItemError } from '@/lib/server/work-items'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireMobileActor(req)
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Work item id is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    const body = await req.json().catch(() => ({})) as { expectedVersion?: unknown }
    const result = await transitionWorkItem({
      key: id,
      actor: actor.name,
      action: 'complete',
      idempotencyKey: req.headers.get('idempotency-key')?.trim() || crypto.randomUUID(),
      expectedVersion: typeof body.expectedVersion === 'number' ? body.expectedVersion : null,
    })
    return NextResponse.json({
      success: true,
      changed: result.changed,
      taskId: result.workItem.key,
      version: result.workItem.version,
    }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    if (error instanceof MobileAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
    }
    if (error instanceof WorkItemError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : error.code === 'invalid' ? 400 : 503
      return NextResponse.json({ error: error.message }, { status, headers: mobileNoStoreHeaders() })
    }
    console.error('[mobile/work-items/:id/complete] mutation failed', error)
    return NextResponse.json({ error: 'Work item could not be completed.' }, { status: 503, headers: mobileNoStoreHeaders() })
  }
}
