import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

const QUEUE_PRESETS = new Set([
  'scheduled_today',
  'followups_today',
  'stale_30',
  'warm_followups',
  'cold_prospecting',
  'tax_2yr',
  'deceased_3yr',
  'priority',
  'next_step',
  'custom',
])

const QUEUE_SORTS = new Set([
  'recommended',
  'due_first',
  'oldest_contact',
  'newest',
  'oldest',
  'motivation',
  'name',
])

interface DialerSavedListRow {
  id: string
  name: string
  agent: string
  preset: string
  campaign: string
  status_filter: string
  priority_filter: string
  min_motivation: number
  search: string
  sort_by: string
  visible_limit: number
  created_at: string
  updated_at: string
}

function toClient(row: DialerSavedListRow) {
  return {
    id: row.id,
    name: row.name,
    agent: row.agent,
    preset: row.preset,
    campaign: row.campaign,
    statusFilter: row.status_filter,
    priorityFilter: row.priority_filter,
    minMotivation: row.min_motivation,
    search: row.search,
    sortBy: row.sort_by,
    visibleLimit: row.visible_limit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function cleanText(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeBody(body: Record<string, unknown>) {
  const preset = typeof body.preset === 'string' && QUEUE_PRESETS.has(body.preset) ? body.preset : 'custom'
  const sortBy = typeof body.sortBy === 'string' && QUEUE_SORTS.has(body.sortBy) ? body.sortBy : 'recommended'
  const visibleLimit = [25, 50, 100].includes(Number(body?.visibleLimit)) ? Number(body.visibleLimit) : 25
  const minMotivation = Math.max(0, Math.min(10, Number(body?.minMotivation) || 0))

  return {
    id: typeof body?.id === 'string' && body.id ? body.id : undefined,
    name: cleanText(body?.name, 'Untitled List'),
    agent: cleanText(body?.agent, 'Team'),
    preset,
    campaign: cleanText(body?.campaign, 'all'),
    status_filter: cleanText(body?.statusFilter, 'all'),
    priority_filter: cleanText(body?.priorityFilter, 'all'),
    min_motivation: minMotivation,
    search: typeof body?.search === 'string' ? body.search.trim() : '',
    sort_by: sortBy,
    visible_limit: visibleLimit,
  }
}

export async function GET() {
  const { data, error } = await supabase
    .from('dialer_saved_lists')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message, savedLists: [] }, { status: 500 })
  }

  return NextResponse.json({ savedLists: ((data || []) as DialerSavedListRow[]).map(toClient) })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>
  const row = normalizeBody(body)
  const { id, ...insertRow } = row

  const query = id
    ? supabase.from('dialer_saved_lists').upsert(row).select('*').single()
    : supabase.from('dialer_saved_lists').insert(insertRow).select('*').single()

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ savedList: toClient(data as DialerSavedListRow) })
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('dialer_saved_lists')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
