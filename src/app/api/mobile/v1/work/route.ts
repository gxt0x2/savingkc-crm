import { NextRequest, NextResponse } from 'next/server'
import {
  MobileAuthError,
  mobileNoStoreHeaders,
  mobileOptionsResponse,
  requireMobileActor,
} from '@/lib/mobile-api/auth'
import {
  handoffDepartmentForWorkDepartment,
  isOperatingDepartment,
} from '@/lib/operating-model/department-responsibility'
import { getTaskWorklist, TaskWorklistError } from '@/lib/server/task-worklist'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(req: NextRequest) {
  try {
    const { actor } = await requireMobileActor(req)
    const params = new URL(req.url).searchParams
    const department = params.get('department') || 'acquisitions'
    const scope = params.get('scope') || 'mine'
    if (!isOperatingDepartment(department) || !['mine', 'unassigned'].includes(scope)) {
      return NextResponse.json(
        { error: 'Choose a valid work department and scope.' },
        { status: 400, headers: mobileNoStoreHeaders() },
      )
    }

    const [tasks, handoffsResult] = await Promise.all([
      getTaskWorklist({
        department,
        status: 'active',
        assignee: scope === 'mine' ? actor.name : '__unassigned',
        lane: 'current',
        limit: 25,
      }),
      supabaseAdmin()
        .from('crm_department_handoffs')
        .select('id,lead_id,from_department,to_department,status,assigned_to,reason,evidence_type,created_at,leads:lead_id(id,full_name,property_address,city,state,station,assigned_agent)')
        .eq('to_department', handoffDepartmentForWorkDepartment(department))
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(25),
    ])

    if (handoffsResult.error) throw new Error('handoff read failed')
    return NextResponse.json({
      actor: actor.name,
      department,
      scope,
      tasks: tasks.items,
      taskCounts: tasks.counts,
      handoffs: handoffsResult.data ?? [],
      serverNow: tasks.serverNow,
    }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    if (error instanceof MobileAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
    }
    if (error instanceof TaskWorklistError && error.code === 'invalid') {
      return NextResponse.json({ error: error.message }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    console.error('[mobile/work] read failed', error)
    return NextResponse.json(
      { error: 'Mobile work is temporarily unavailable.' },
      { status: 503, headers: mobileNoStoreHeaders() },
    )
  }
}
