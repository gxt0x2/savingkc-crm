import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { ScCampaignStatus } from '@/lib/smartercontact/types'

const STATUSES: ScCampaignStatus[] = [
  'draft',
  'scheduled',
  'active',
  'paused',
  'completed',
  'deleted',
]

/**
 * GET /api/sc/campaigns?type=standard&status=active
 * Lists campaigns for the given type (default 'standard'), optionally filtered
 * by status, plus a per-status count map for the sidebar. Returns
 * { campaigns, counts }.
 */
export async function GET(req: Request) {
  const db = supabaseAdmin()
  const url = new URL(req.url)
  const type = url.searchParams.get('type') || 'standard'
  const status = url.searchParams.get('status')

  let q = db
    .from('sc_campaigns')
    .select('*')
    .eq('type', type)
    .order('created_at', { ascending: false })

  // 'all' (or absent) shows everything except deleted unless deleted is asked for.
  if (status && status !== 'all') {
    q = q.eq('status', status)
  } else {
    q = q.neq('status', 'deleted')
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sidebar counts: one grouped query, folded into a status→count map.
  const { data: allForCounts } = await db
    .from('sc_campaigns')
    .select('status')
    .eq('type', type)

  const counts: Record<string, number> = { all: 0 }
  for (const s of STATUSES) counts[s] = 0
  for (const row of allForCounts || []) {
    const s = row.status as string
    counts[s] = (counts[s] || 0) + 1
    if (s !== 'deleted') counts.all += 1
  }

  return NextResponse.json({ campaigns: data || [], counts })
}

/**
 * POST /api/sc/campaigns — create a campaign (defaults to 'draft').
 * Body: { name, group_id, message_body, template_id?, from_strategy,
 *         sending_number_ids, throttle_per_hour, send_window_start?,
 *         send_window_end?, timezone, scheduled_at? }
 */
export async function POST(req: Request) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({}))

  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const row = {
    name: String(body.name).trim(),
    type: 'standard' as const,
    status: 'draft' as const,
    group_id: body.group_id || null,
    message_body: body.message_body || null,
    template_id: body.template_id || null,
    from_strategy: body.from_strategy === 'single' ? 'single' : 'pool',
    sending_number_ids: Array.isArray(body.sending_number_ids)
      ? body.sending_number_ids
      : [],
    throttle_per_hour:
      typeof body.throttle_per_hour === 'number' && body.throttle_per_hour > 0
        ? body.throttle_per_hour
        : 500,
    send_window_start: body.send_window_start || null,
    send_window_end: body.send_window_end || null,
    timezone: body.timezone || 'America/Chicago',
    scheduled_at: body.scheduled_at || null,
  }

  const { data, error } = await db
    .from('sc_campaigns')
    .insert(row)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ campaign: data })
}

/**
 * PATCH /api/sc/campaigns — update editable fields by id, including simple
 * status transitions (pause/resume/delete) driven from the list view.
 * Body: { id, ...fields }
 */
export async function PATCH(req: Request) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({}))
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  const editable = [
    'name',
    'group_id',
    'message_body',
    'template_id',
    'from_strategy',
    'sending_number_ids',
    'throttle_per_hour',
    'send_window_start',
    'send_window_end',
    'timezone',
    'scheduled_at',
  ]
  for (const f of editable) {
    if (f in body) patch[f] = body[f]
  }
  if ('status' in body) {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    patch.status = body.status
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await db
    .from('sc_campaigns')
    .update(patch)
    .eq('id', body.id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ campaign: data })
}
