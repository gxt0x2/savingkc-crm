import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUserEmail } from '@/lib/auth/admin'
import { supabaseAdmin } from '@/lib/supabase/admin'

const NO_STORE_HEADERS: HeadersInit = { 'Cache-Control': 'private, no-store, max-age=0' }
const PROTOCOLS = new Set(['sod', 'eod'])

function dayKey(value: string | Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value))
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function GET() {
  const email = await getCurrentUserEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })

  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabaseAdmin()
    .from('lead_activities')
    .select('id, activity_type, metadata, created_at')
    .eq('agent', email)
    .in('activity_type', ['sod_submission', 'eod_submission'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Daily Rhythm could not load.' }, { status: 500, headers: NO_STORE_HEADERS })

  const today = dayKey(new Date())
  const todayRows = (data ?? []).filter((row) => dayKey(row.created_at) === today)
  const submission = (protocol: 'sod' | 'eod') => {
    const row = todayRows.find((candidate) => candidate.activity_type === `${protocol}_submission`)
    return row ? { id: row.id, protocol, submittedAt: row.created_at, ...record(row.metadata) } : null
  }

  return NextResponse.json({ date: today, sod: submission('sod'), eod: submission('eod') }, { headers: NO_STORE_HEADERS })
}

export async function POST(request: NextRequest) {
  const email = await getCurrentUserEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })

  const body = record(await request.json())
  const protocol = String(body.protocol ?? '').toLowerCase()
  const checklist = Array.isArray(body.checklist) ? body.checklist.filter((item): item is string => typeof item === 'string').slice(0, 10) : []
  if (!PROTOCOLS.has(protocol) || checklist.length === 0) {
    return NextResponse.json({ error: 'Complete at least one operating step before submitting.' }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const metadata = {
    protocol,
    checklist,
    focus: String(body.focus ?? '').trim().slice(0, 500),
    coachingCommitment: String(body.coachingCommitment ?? '').trim().slice(0, 500),
    energy: Math.max(1, Math.min(5, Number(body.energy) || 3)),
    win: String(body.win ?? '').trim().slice(0, 1000),
    lesson: String(body.lesson ?? '').trim().slice(0, 1000),
    tomorrow: String(body.tomorrow ?? '').trim().slice(0, 1000),
  }
  const activityType = `${protocol}_submission`
  const today = dayKey(new Date())
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const db = supabaseAdmin()
  const { data: candidates } = await db
    .from('lead_activities')
    .select('id, created_at')
    .eq('agent', email)
    .eq('activity_type', activityType)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  const existing = (candidates ?? []).find((row) => dayKey(row.created_at) === today)

  const operation = existing
    ? db.from('lead_activities').update({ metadata, description: `${protocol.toUpperCase()} Daily Rhythm completed` }).eq('id', existing.id).select('id, created_at').single()
    : db.from('lead_activities').insert({ activity_type: activityType, agent: email, description: `${protocol.toUpperCase()} Daily Rhythm completed`, metadata }).select('id, created_at').single()
  const { data, error } = await operation

  if (error) return NextResponse.json({ error: 'Daily Rhythm could not be saved.' }, { status: 500, headers: NO_STORE_HEADERS })
  return NextResponse.json({ success: true, id: data.id, submittedAt: data.created_at }, { headers: NO_STORE_HEADERS })
}
