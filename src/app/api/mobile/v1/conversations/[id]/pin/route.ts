import { NextRequest, NextResponse } from 'next/server'

import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileUser } from '@/lib/mobile-api/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireMobileUser(req)
    const { id } = await params
    const body = await req.json().catch(() => null) as { pinned?: unknown } | null
    if (!id || typeof body?.pinned !== 'boolean') {
      return NextResponse.json({ error: 'lead id and pinned boolean are required' }, { status: 400, headers: mobileNoStoreHeaders() })
    }

    const db = supabaseAdmin()
    const { data: lead, error: leadError } = await db.from('leads').select('id').eq('id', id).maybeSingle()
    if (leadError) throw new Error(leadError.message)
    if (!lead) return NextResponse.json({ error: 'Conversation not found' }, { status: 404, headers: mobileNoStoreHeaders() })

    const current = Array.isArray(user.app_metadata?.pinned_chat_ids)
      ? user.app_metadata.pinned_chat_ids.filter((value): value is string => typeof value === 'string')
      : []
    const next = body.pinned
      ? [...new Set([id, ...current])].slice(0, 20)
      : current.filter((value) => value !== id)
    if (next.length === current.length && next.every((value, index) => value === current[index])) {
      return NextResponse.json({ success: true, leadId: id, pinned: body.pinned }, { headers: mobileNoStoreHeaders() })
    }
    const { error: updateError } = await db.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, pinned_chat_ids: next },
    })
    if (updateError) throw new Error(updateError.message)
    return NextResponse.json({ success: true, leadId: id, pinned: body.pinned }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof MobileAuthError ? error.message : 'Pinned chat could not be updated.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
