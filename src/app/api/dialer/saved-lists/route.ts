import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { normalizeDialerCallerPlan } from '@/lib/dialer-caller-plan'

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
  caller_id?: string | null
  caller_mode?: string | null
  rotation_caller_ids?: unknown
  rotate_every_calls?: number | null
  redial_caller_id?: string | null
  start_behavior?: string | null
  optional_filters?: unknown
  call_hammer?: boolean | null
  voicemail_call_hammer?: boolean | null
  campaign: string
  status_filter: string
  priority_filter: string
  min_motivation: number
  search: string
  sort_by: string
  visible_limit: number
  session_lead_ids?: unknown
  resume_index?: number | null
  resume_lead_id?: string | null
  resume_updated_at?: string | null
  session_completed?: boolean | null
  created_at: string
  updated_at: string
}

interface OptionalDialingFilters {
  attemptsFrom: string
  attemptsTo: string
  notDialed: 'none' | 'never' | '7d' | '14d' | '30d'
  notContactedDays: 'none' | '1' | '3' | '7' | '14' | '30'
  createDateFrom: string
  createDateTo: string
  statusChangeFrom: string
  statusChangeTo: string
  callOldestToNewest: boolean
}

interface ErrorLike {
  code?: string
  message?: string
  details?: string
}

function normalizeLeadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizeOptionalFilters(value: unknown): OptionalDialingFilters {
  const source = value && typeof value === 'object' ? (value as Partial<OptionalDialingFilters>) : {}
  return {
    attemptsFrom: typeof source.attemptsFrom === 'string' ? source.attemptsFrom.trim() : '',
    attemptsTo: typeof source.attemptsTo === 'string' ? source.attemptsTo.trim() : '',
    notDialed: source.notDialed === 'never' || source.notDialed === '7d' || source.notDialed === '14d' || source.notDialed === '30d'
      ? source.notDialed
      : 'none',
    notContactedDays: source.notContactedDays === '1' || source.notContactedDays === '3' || source.notContactedDays === '7' || source.notContactedDays === '14' || source.notContactedDays === '30'
      ? source.notContactedDays
      : 'none',
    createDateFrom: typeof source.createDateFrom === 'string' ? source.createDateFrom : '',
    createDateTo: typeof source.createDateTo === 'string' ? source.createDateTo : '',
    statusChangeFrom: typeof source.statusChangeFrom === 'string' ? source.statusChangeFrom : '',
    statusChangeTo: typeof source.statusChangeTo === 'string' ? source.statusChangeTo : '',
    callOldestToNewest: Boolean(source.callOldestToNewest),
  }
}

function toClient(row: DialerSavedListRow) {
  const callerPlan = normalizeDialerCallerPlan(
    {
      mode: row.caller_mode === 'rotation' ? 'rotation' : 'static',
      staticCallerId: row.caller_id || '',
      rotationCallerIds: normalizeLeadIds(row.rotation_caller_ids),
      rotateEveryCalls: Number(row.rotate_every_calls) || 50,
      redialCallerId: row.redial_caller_id || null,
    },
    row.caller_id || '',
  )
  const startBehavior = row.start_behavior === 'top' ? 'top' : 'resume'

  return {
    id: row.id,
    name: row.name,
    agent: row.agent,
    preset: row.preset,
    callerId: callerPlan.staticCallerId,
    callerMode: callerPlan.mode,
    rotationCallerIds: callerPlan.rotationCallerIds,
    rotateEveryCalls: callerPlan.rotateEveryCalls,
    redialCallerId: callerPlan.redialCallerId,
    startBehavior,
    optionalFilters: normalizeOptionalFilters(row.optional_filters),
    useCallHammer: Boolean(row.call_hammer),
    useVoicemailCallHammer: Boolean(row.voicemail_call_hammer),
    campaign: row.campaign,
    statusFilter: row.status_filter,
    priorityFilter: row.priority_filter,
    minMotivation: row.min_motivation,
    search: row.search,
    sortBy: row.sort_by,
    visibleLimit: row.visible_limit,
    sessionLeadIds: normalizeLeadIds(row.session_lead_ids),
    resumeIndex: Number.isFinite(Number(row.resume_index)) ? Math.max(0, Number(row.resume_index)) : 0,
    resumeLeadId: row.resume_lead_id || null,
    resumeUpdatedAt: row.resume_updated_at || null,
    sessionCompleted: Boolean(row.session_completed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function hasMissingColumnError(error: ErrorLike | null | undefined, column: string): boolean {
  if (!error) return false
  const lower = `${error.message || ''} ${error.details || ''}`.toLowerCase()
  if (error.code === 'PGRST204') return lower.includes(column.toLowerCase())
  return lower.includes('column') && lower.includes(column.toLowerCase())
}

function cleanText(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeBody(body: Record<string, unknown>) {
  const preset = typeof body.preset === 'string' && QUEUE_PRESETS.has(body.preset) ? body.preset : 'custom'
  const sortBy = typeof body.sortBy === 'string' && QUEUE_SORTS.has(body.sortBy) ? body.sortBy : 'recommended'
  const visibleLimit = [25, 50, 100].includes(Number(body?.visibleLimit)) ? Number(body.visibleLimit) : 25
  const minMotivation = Math.max(0, Math.min(10, Number(body?.minMotivation) || 0))
  const callerId = typeof body?.callerId === 'string' ? body.callerId.trim() : ''
  const callerPlan = normalizeDialerCallerPlan(
    {
      mode: body?.callerMode === 'rotation' ? 'rotation' : 'static',
      staticCallerId: callerId,
      rotationCallerIds: normalizeLeadIds(body?.rotationCallerIds),
      rotateEveryCalls: Number(body?.rotateEveryCalls) || 50,
      redialCallerId: typeof body?.redialCallerId === 'string' ? body.redialCallerId : null,
    },
    callerId,
  )
  const startBehavior = body?.startBehavior === 'top' ? 'top' : 'resume'
  const optionalFilters = normalizeOptionalFilters(body?.optionalFilters)
  const useCallHammer = Boolean(body?.useCallHammer)
  const useVoicemailCallHammer = Boolean(body?.useVoicemailCallHammer)
  const sessionLeadIds = normalizeLeadIds(body?.sessionLeadIds)

  return {
    id: typeof body?.id === 'string' && body.id ? body.id : undefined,
    name: cleanText(body?.name, 'Untitled List'),
    agent: cleanText(body?.agent, 'Team'),
    preset,
    caller_id: callerPlan.staticCallerId,
    caller_mode: callerPlan.mode,
    rotation_caller_ids: callerPlan.rotationCallerIds,
    rotate_every_calls: callerPlan.rotateEveryCalls,
    redial_caller_id: callerPlan.redialCallerId,
    start_behavior: startBehavior,
    optional_filters: optionalFilters,
    call_hammer: useCallHammer,
    voicemail_call_hammer: useVoicemailCallHammer,
    campaign: cleanText(body?.campaign, 'all'),
    status_filter: cleanText(body?.statusFilter, 'all'),
    priority_filter: cleanText(body?.priorityFilter, 'all'),
    min_motivation: minMotivation,
    search: typeof body?.search === 'string' ? body.search.trim() : '',
    sort_by: sortBy,
    visible_limit: visibleLimit,
    session_lead_ids: sessionLeadIds,
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

  const primaryQuery = id
    ? supabase.from('dialer_saved_lists').upsert(row).select('*').single()
    : supabase.from('dialer_saved_lists').insert(insertRow).select('*').single()

  const { data, error } = await primaryQuery

  if (!error) {
    return NextResponse.json({ savedList: toClient(data as DialerSavedListRow) })
  }

  const modernColumns = [
    'caller_id',
    'caller_mode',
    'rotation_caller_ids',
    'rotate_every_calls',
    'redial_caller_id',
    'start_behavior',
    'optional_filters',
    'call_hammer',
    'voicemail_call_hammer',
    'session_lead_ids',
  ]
  const hasModernColumnError = modernColumns.some((column) => hasMissingColumnError(error, column))

  // Backward-compat: older DB schemas may not have newer dialer fields yet.
  if (!hasModernColumnError) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const legacyRow = { ...row }
  modernColumns.forEach((column) => {
    delete (legacyRow as Record<string, unknown>)[column]
  })
  const { id: legacyId, ...legacyInsertRow } = legacyRow

  const legacyQuery = legacyId
    ? supabase.from('dialer_saved_lists').upsert(legacyRow).select('*').single()
    : supabase.from('dialer_saved_lists').insert(legacyInsertRow).select('*').single()

  const { data: legacyData, error: legacyError } = await legacyQuery
  if (legacyError) {
    return NextResponse.json({ error: legacyError.message }, { status: 500 })
  }

  const mergedRow = {
    ...(legacyData as DialerSavedListRow),
    caller_id: row.caller_id,
    caller_mode: row.caller_mode,
    rotation_caller_ids: row.rotation_caller_ids,
    rotate_every_calls: row.rotate_every_calls,
    redial_caller_id: row.redial_caller_id,
    start_behavior: row.start_behavior,
    optional_filters: row.optional_filters,
    call_hammer: row.call_hammer,
    voicemail_call_hammer: row.voicemail_call_hammer,
    session_lead_ids: row.session_lead_ids,
  } as DialerSavedListRow

  return NextResponse.json({ savedList: toClient(mergedRow), schemaFallback: true })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}

  if (typeof body?.callerId === 'string') {
    updates.caller_id = body.callerId.trim()
  }

  if ('callerMode' in body) {
    updates.caller_mode = body.callerMode === 'rotation' ? 'rotation' : 'static'
  }

  if ('rotationCallerIds' in body) {
    updates.rotation_caller_ids = normalizeLeadIds(body.rotationCallerIds)
  }

  if ('rotateEveryCalls' in body) {
    const value = Number(body.rotateEveryCalls)
    updates.rotate_every_calls = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 50
  }

  if ('redialCallerId' in body) {
    if (body.redialCallerId === null) {
      updates.redial_caller_id = null
    } else if (typeof body.redialCallerId === 'string') {
      updates.redial_caller_id = body.redialCallerId.trim() || null
    }
  }

  if ('startBehavior' in body) {
    updates.start_behavior = body.startBehavior === 'top' ? 'top' : 'resume'
  }

  if ('optionalFilters' in body) {
    updates.optional_filters = normalizeOptionalFilters(body.optionalFilters)
  }

  if ('useCallHammer' in body) {
    updates.call_hammer = Boolean(body.useCallHammer)
  }

  if ('useVoicemailCallHammer' in body) {
    updates.voicemail_call_hammer = Boolean(body.useVoicemailCallHammer)
  }

  if (Array.isArray(body?.sessionLeadIds)) {
    updates.session_lead_ids = normalizeLeadIds(body.sessionLeadIds)
  }

  if (body?.resumeIndex !== undefined) {
    const value = Number(body.resumeIndex)
    updates.resume_index = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  }

  if (body?.resumeLeadId === null) {
    updates.resume_lead_id = null
  } else if (typeof body?.resumeLeadId === 'string') {
    updates.resume_lead_id = body.resumeLeadId.trim() || null
  }

  if (typeof body?.sessionCompleted === 'boolean') {
    updates.session_completed = body.sessionCompleted
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  updates.resume_updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('dialer_saved_lists')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (!error) {
    return NextResponse.json({ savedList: toClient(data as DialerSavedListRow) })
  }

  const unsupported = [
    'caller_id',
    'caller_mode',
    'rotation_caller_ids',
    'rotate_every_calls',
    'redial_caller_id',
    'start_behavior',
    'optional_filters',
    'call_hammer',
    'voicemail_call_hammer',
    'session_lead_ids',
    'resume_index',
    'resume_lead_id',
    'resume_updated_at',
    'session_completed',
  ]
  const hasUnsupportedColumnError = unsupported.some((column) => hasMissingColumnError(error, column))
  if (!hasUnsupportedColumnError) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: existing, error: existingError } = await supabase
    .from('dialer_saved_lists')
    .select('*')
    .eq('id', id)
    .single()

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  const mergedRow = {
    ...(existing as DialerSavedListRow),
    caller_id: typeof body?.callerId === 'string' ? body.callerId.trim() : (existing as DialerSavedListRow).caller_id,
    caller_mode: typeof body?.callerMode === 'string'
      ? (body.callerMode === 'rotation' ? 'rotation' : 'static')
      : (existing as DialerSavedListRow).caller_mode,
    rotation_caller_ids: Array.isArray(body?.rotationCallerIds)
      ? normalizeLeadIds(body.rotationCallerIds)
      : (existing as DialerSavedListRow).rotation_caller_ids,
    rotate_every_calls: body?.rotateEveryCalls !== undefined
      ? Math.max(1, Math.floor(Number(body.rotateEveryCalls) || 50))
      : (existing as DialerSavedListRow).rotate_every_calls,
    redial_caller_id: body?.redialCallerId !== undefined
      ? (typeof body.redialCallerId === 'string' ? body.redialCallerId.trim() || null : null)
      : (existing as DialerSavedListRow).redial_caller_id,
    start_behavior: body?.startBehavior !== undefined
      ? (body.startBehavior === 'top' ? 'top' : 'resume')
      : (existing as DialerSavedListRow).start_behavior,
    optional_filters: body?.optionalFilters !== undefined
      ? normalizeOptionalFilters(body.optionalFilters)
      : (existing as DialerSavedListRow).optional_filters,
    call_hammer: body?.useCallHammer !== undefined
      ? Boolean(body.useCallHammer)
      : (existing as DialerSavedListRow).call_hammer,
    voicemail_call_hammer: body?.useVoicemailCallHammer !== undefined
      ? Boolean(body.useVoicemailCallHammer)
      : (existing as DialerSavedListRow).voicemail_call_hammer,
    session_lead_ids: Array.isArray(body?.sessionLeadIds) ? normalizeLeadIds(body.sessionLeadIds) : (existing as DialerSavedListRow).session_lead_ids,
    resume_index: body?.resumeIndex !== undefined ? Number(body.resumeIndex) : (existing as DialerSavedListRow).resume_index,
    resume_lead_id: body?.resumeLeadId !== undefined
      ? (typeof body.resumeLeadId === 'string' ? body.resumeLeadId.trim() || null : null)
      : (existing as DialerSavedListRow).resume_lead_id,
    resume_updated_at: new Date().toISOString(),
    session_completed: typeof body?.sessionCompleted === 'boolean'
      ? body.sessionCompleted
      : (existing as DialerSavedListRow).session_completed,
  } as DialerSavedListRow

  return NextResponse.json({ savedList: toClient(mergedRow), schemaFallback: true })
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
