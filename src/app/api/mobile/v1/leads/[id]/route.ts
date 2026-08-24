import { NextRequest, NextResponse } from 'next/server'
import { requireMobileUser, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { operatingDepartmentForStage } from '@/lib/operating-model/department-responsibility'
import { listWorkItems } from '@/lib/server/work-items'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

const LEAD_SELECT = [
  'id',
  'full_name',
  'phone',
  'email',
  'property_address',
  'city',
  'state',
  'zip',
  'county',
  'station',
  'classification',
  'dead_reason',
  'priority',
  'motivation_score',
  'seller_situation',
  'appointment_date',
  'assigned_agent',
  'updated_at',
  'created_at',
].join(', ')

type MobileLeadRow = Record<string, unknown> & {
  station: string | null
  assigned_agent: string | null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireMobileUser(req)
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400, headers: mobileNoStoreHeaders() })
    }

    const db = supabaseAdmin()
    const [leadRes, activityRes, workItemsState, handoffsRes] = await Promise.all([
      db.from('leads').select(LEAD_SELECT).eq('id', id).maybeSingle(),
      db
        .from('lead_activities')
        .select('id, activity_type, description, agent, metadata, created_at')
        .eq('lead_id', id)
        .order('created_at', { ascending: false })
        .limit(10),
      listWorkItems({ leadId: id, statuses: ['pending', 'blocked'], limit: 20 })
        .then((data) => ({ data, error: null }))
        .catch((error: unknown) => ({ data: [], error })),
      db
        .from('crm_department_handoffs')
        .select('id,from_department,to_department,status,assigned_to,reason,evidence_type,created_at')
        .eq('lead_id', id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    if (leadRes.error) {
      return NextResponse.json(
        { error: leadRes.error.message },
        { status: 500, headers: mobileNoStoreHeaders() },
      )
    }

    if (!leadRes.data) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404, headers: mobileNoStoreHeaders() })
    }

    if (activityRes.error) {
      return NextResponse.json(
        { error: activityRes.error.message },
        { status: 500, headers: mobileNoStoreHeaders() },
      )
    }

    const lead = leadRes.data as unknown as MobileLeadRow
    if (workItemsState.error) console.error('[mobile/leads/:id] work-item read failed', workItemsState.error)
    if (handoffsRes.error) console.error('[mobile/leads/:id] handoff read failed', handoffsRes.error.message)
    const primaryNextAction = workItemsState.data.find((item) => item.primaryNextAction)
      ?? workItemsState.data[0]
      ?? null

    return NextResponse.json(
      {
        lead,
        activities: activityRes.data || [],
        operations: {
          department: operatingDepartmentForStage(lead.station),
          owner: lead.assigned_agent ?? null,
          primaryNextAction,
          tasksAvailable: !workItemsState.error,
          pendingHandoffs: handoffsRes.error ? [] : handoffsRes.data ?? [],
          handoffsAvailable: !handoffsRes.error,
        },
      },
      { headers: mobileNoStoreHeaders() },
    )
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof MobileAuthError ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
