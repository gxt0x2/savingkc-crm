import { supabaseAdmin } from '@/lib/supabase/admin'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface EntityConflictCursor {
  detectedAt: string
  id: string
}

interface EntityConflictRow {
  id: string
  lead_id: string
  conflict_type: 'phone_email_disagree' | 'method_claimed_elsewhere'
  selected_person_id: string
  conflicting_person_id: string | null
  method_type: 'phone' | 'email' | null
  normalized_value: string | null
  status: 'open' | 'resolved' | 'ignored'
  detected_at: string
}

export interface CrmEntityConflictItem {
  id: string
  leadId: string
  conflictType: EntityConflictRow['conflict_type']
  methodType: EntityConflictRow['method_type']
  maskedValue: string | null
  status: EntityConflictRow['status']
  detectedAt: string
  selectedPerson: { id: string; displayName: string } | null
  conflictingPerson: { id: string; displayName: string } | null
  lead: {
    id: string
    fullName: string | null
    propertyAddress: string | null
    station: string | null
    assignedAgent: string | null
  } | null
}

export interface CrmEntityConflictPage {
  items: CrmEntityConflictItem[]
  pageInfo: {
    limit: number
    hasMore: boolean
    nextCursor: string | null
  }
}

export class InvalidEntityConflictCursorError extends Error {
  constructor() {
    super('Invalid entity conflict cursor')
    this.name = 'InvalidEntityConflictCursorError'
  }
}

export function normalizeEntityConflictLimit(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT
  return Math.min(Math.trunc(parsed), MAX_LIMIT)
}

function encodeCursor(value: EntityConflictCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

export function parseEntityConflictCursor(value: string | null | undefined): EntityConflictCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<EntityConflictCursor>
    if (!parsed.detectedAt || Number.isNaN(Date.parse(parsed.detectedAt)) || !parsed.id || !UUID_PATTERN.test(parsed.id)) {
      throw new InvalidEntityConflictCursorError()
    }
    return { detectedAt: new Date(parsed.detectedAt).toISOString(), id: parsed.id }
  } catch (error) {
    if (error instanceof InvalidEntityConflictCursorError) throw error
    throw new InvalidEntityConflictCursorError()
  }
}

export function maskEntityConflictValue(methodType: EntityConflictRow['method_type'], value: string | null): string | null {
  if (!value) return null
  if (methodType === 'email') {
    const at = value.lastIndexOf('@')
    return at > 0 ? `•••${value.slice(at)}` : '•••'
  }
  const digits = value.replace(/\D/g, '')
  return digits ? `•••${digits.slice(-4)}` : '•••'
}

export async function readCrmEntityConflictsPage(input: {
  limit?: string | number | null
  cursor?: string | null
} = {}): Promise<CrmEntityConflictPage> {
  const limit = normalizeEntityConflictLimit(input.limit)
  const cursor = parseEntityConflictCursor(input.cursor)
  const db = supabaseAdmin()

  let query = db
    .from('crm_identity_conflicts')
    .select('id, lead_id, conflict_type, selected_person_id, conflicting_person_id, method_type, normalized_value, status, detected_at')
    .eq('status', 'open')
    .order('detected_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (cursor) {
    query = query.or(`detected_at.lt.${cursor.detectedAt},and(detected_at.eq.${cursor.detectedAt},id.lt.${cursor.id})`)
  }

  const { data, error } = await query
  if (error) throw new Error(`CRM identity conflict page failed: ${error.message}`)

  const rows = ((data ?? []) as EntityConflictRow[]).slice(0, limit)
  const hasMore = (data?.length ?? 0) > limit
  const personIds = [...new Set(rows.flatMap((row) => [row.selected_person_id, row.conflicting_person_id]).filter((id): id is string => Boolean(id)))]
  const leadIds = [...new Set(rows.map((row) => row.lead_id))]

  const [peopleResult, leadResult] = await Promise.all([
    personIds.length
      ? db.from('crm_people').select('id, display_name').in('id', personIds)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length
      ? db.from('leads').select('id, full_name, property_address, station, assigned_agent').in('id', leadIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (peopleResult.error) throw new Error(`CRM identity conflict people failed: ${peopleResult.error.message}`)
  if (leadResult.error) throw new Error(`CRM identity conflict leads failed: ${leadResult.error.message}`)

  const people = new Map((peopleResult.data ?? []).map((person) => [person.id, person.display_name]))
  const leads = new Map((leadResult.data ?? []).map((lead) => [lead.id, lead]))

  const items = rows.map((row): CrmEntityConflictItem => {
    const lead = leads.get(row.lead_id)
    const selectedName = people.get(row.selected_person_id)
    const conflictingName = row.conflicting_person_id ? people.get(row.conflicting_person_id) : null
    return {
      id: row.id,
      leadId: row.lead_id,
      conflictType: row.conflict_type,
      methodType: row.method_type,
      maskedValue: maskEntityConflictValue(row.method_type, row.normalized_value),
      status: row.status,
      detectedAt: row.detected_at,
      selectedPerson: selectedName ? { id: row.selected_person_id, displayName: selectedName } : null,
      conflictingPerson: row.conflicting_person_id && conflictingName
        ? { id: row.conflicting_person_id, displayName: conflictingName }
        : null,
      lead: lead ? {
        id: lead.id,
        fullName: lead.full_name,
        propertyAddress: lead.property_address,
        station: lead.station,
        assignedAgent: lead.assigned_agent,
      } : null,
    }
  })

  const last = rows.at(-1)
  return {
    items,
    pageInfo: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor({ detectedAt: last.detected_at, id: last.id }) : null,
    },
  }
}
