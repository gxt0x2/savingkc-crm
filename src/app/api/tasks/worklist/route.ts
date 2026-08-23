export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { getTaskWorklist, TaskWorklistError } from '@/lib/server/task-worklist'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const params = new URL(request.url).searchParams
  const requestedLane = params.get('lane')
  if (requestedLane && requestedLane !== 'current') {
    return NextResponse.json({
      error: 'Historical task lanes are retired from operator worklists.',
      replacement: '/tasks',
    }, { status: 410, headers: NO_STORE })
  }
  try {
    const page = await getTaskWorklist({
      department: params.get('department') || undefined,
      view: params.get('view') || undefined,
      status: params.get('status') || undefined,
      assignee: params.get('assignee') || undefined,
      due: params.get('due') || undefined,
      type: params.get('type') || undefined,
      query: params.get('q') || undefined,
      sort: params.get('sort') || undefined,
      limit: params.has('limit') ? Number(params.get('limit')) : undefined,
      cursor: params.get('cursor'),
      lane: 'current',
    })
    return NextResponse.json(page, {
      headers: {
        ...NO_STORE,
        'Server-Timing': `task_rows;desc="${page.items.length}", task_total;desc="${page.pageInfo.total}"`,
      },
    })
  } catch (error) {
    if (error instanceof TaskWorklistError && error.code === 'invalid') {
      return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE })
    }
    console.error('[tasks/worklist] read failed', error)
    return NextResponse.json({ error: 'Task worklist is unavailable.' }, { status: 503, headers: NO_STORE })
  }
}
