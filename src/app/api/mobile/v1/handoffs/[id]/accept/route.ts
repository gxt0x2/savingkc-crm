import { NextRequest, NextResponse } from 'next/server'
import {
  MobileAuthError,
  mobileNoStoreHeaders,
  mobileOptionsResponse,
  requireMobileActor,
} from '@/lib/mobile-api/auth'
import { acceptDepartmentHandoff, CrmOperatingHandoffError } from '@/lib/server/crm-operating-handoffs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireMobileActor(req)
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Handoff id is required.' }, { status: 400, headers: mobileNoStoreHeaders() })
    const handoff = await acceptDepartmentHandoff({ handoffId: id, actorEmail: actor.email, actorName: actor.name })
    return NextResponse.json({ success: true, handoff }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    if (error instanceof MobileAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
    }
    if (error instanceof CrmOperatingHandoffError) {
      return NextResponse.json({ error: error.message }, { status: 409, headers: mobileNoStoreHeaders() })
    }
    console.error('[mobile/handoffs/:id/accept] mutation failed', error)
    return NextResponse.json({ error: 'Department handoff could not be accepted.' }, { status: 503, headers: mobileNoStoreHeaders() })
  }
}
