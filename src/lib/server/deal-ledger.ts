import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  DEAL_LEDGER_CATEGORIES,
  DEAL_LEDGER_DIRECTIONS,
  type DealLedgerCategory,
  type DealLedgerDirection,
  type DealLedgerLine,
} from '@/types/deal-ledger'

export {
  DEAL_LEDGER_CATEGORIES,
  DEAL_LEDGER_DIRECTIONS,
  type DealLedgerCategory,
  type DealLedgerDirection,
  type DealLedgerLine,
}

export interface DealLedgerPostInput {
  leadId?: string | null
  fileNumber?: string | null
  propertyAddress?: string | null
  amount: number
  direction: DealLedgerDirection
  postedOn: string
  source: string
  memo?: string | null
  category: DealLedgerCategory
  idempotencyKey?: string | null
  actor?: string | null
}

export interface DealLedgerListQuery {
  leadId?: string | null
  fileNumber?: string | null
  tcFileId?: string | null
}

export class DealLedgerError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'not_found' | 'conflict' | 'ambiguous' | 'unavailable',
    readonly status: number,
  ) {
    super(message)
  }
}

export function isDealLedgerCategory(value: unknown): value is DealLedgerCategory {
  return typeof value === 'string' && (DEAL_LEDGER_CATEGORIES as readonly string[]).includes(value)
}

export function isDealLedgerDirection(value: unknown): value is DealLedgerDirection {
  return typeof value === 'string' && (DEAL_LEDGER_DIRECTIONS as readonly string[]).includes(value)
}

function asLine(value: unknown): DealLedgerLine | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount)
  if (!Number.isFinite(amount) || !isDealLedgerDirection(row.direction) || !isDealLedgerCategory(row.category)) {
    return null
  }
  if (typeof row.id !== 'string' || typeof row.lead_id !== 'string' || typeof row.source !== 'string') return null
  if (typeof row.posted_on !== 'string' || typeof row.idempotency_key !== 'string' || typeof row.created_at !== 'string') {
    return null
  }
  return {
    id: row.id,
    lead_id: row.lead_id,
    tc_file_id: typeof row.tc_file_id === 'string' ? row.tc_file_id : null,
    dispo_deal_id: typeof row.dispo_deal_id === 'string' ? row.dispo_deal_id : null,
    file_number: typeof row.file_number === 'string' ? row.file_number : null,
    property_address: typeof row.property_address === 'string' ? row.property_address : null,
    amount,
    direction: row.direction,
    posted_on: row.posted_on,
    source: row.source,
    memo: typeof row.memo === 'string' ? row.memo : null,
    category: row.category,
    idempotency_key: row.idempotency_key,
    actor: typeof row.actor === 'string' ? row.actor : 'system',
    created_at: row.created_at,
  }
}

function mapPostError(message: string): DealLedgerError {
  if (message.includes('deal_not_found')) return new DealLedgerError('Deal File was not found.', 'not_found', 404)
  if (message.includes('deal_ambiguous')) return new DealLedgerError('Deal key matched more than one file.', 'ambiguous', 409)
  if (message.includes('deal_key_conflict') || message.includes('ledger_line_conflict') || message.includes('deal_ledger_immutable')) {
    return new DealLedgerError('Posted ledger line conflicts with an existing line.', 'conflict', 409)
  }
  if (
    message.includes('deal_key_required') ||
    message.includes('invalid_amount') ||
    message.includes('invalid_direction') ||
    message.includes('invalid_category') ||
    message.includes('invalid_source') ||
    message.includes('invalid_posted_on') ||
    message.includes('invalid_memo') ||
    message.includes('invalid_idempotency_key') ||
    message.includes('invalid_actor')
  ) {
    return new DealLedgerError('Ledger line is invalid.', 'invalid', 400)
  }
  return new DealLedgerError('Deal File ledger is unavailable.', 'unavailable', 503)
}

export async function postDealLedgerLine(input: DealLedgerPostInput): Promise<{ line: DealLedgerLine; replayed: boolean }> {
  const { data, error } = await supabaseAdmin().rpc('post_crm_deal_ledger_line_v1', {
    target_lead_id: input.leadId || null,
    target_file_number: input.fileNumber || null,
    target_property_address: input.propertyAddress || null,
    target_amount: input.amount,
    target_direction: input.direction,
    target_posted_on: input.postedOn,
    target_source: input.source,
    target_memo: input.memo || null,
    target_category: input.category,
    target_idempotency_key: input.idempotencyKey || null,
    target_actor: input.actor || null,
  })

  if (error) throw mapPostError(error.message ?? 'post_failed')
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null
  const line = asLine(payload?.line)
  if (!line) throw new DealLedgerError('Deal File ledger returned an invalid line.', 'unavailable', 503)
  return { line, replayed: payload?.replayed === true }
}

export async function listDealLedgerLines(query: DealLedgerListQuery): Promise<DealLedgerLine[]> {
  if (!query.leadId && !query.fileNumber && !query.tcFileId) {
    throw new DealLedgerError('Deal key is required.', 'invalid', 400)
  }

  let request = supabaseAdmin()
    .from('crm_deal_ledger_lines')
    .select(
      'id, lead_id, tc_file_id, dispo_deal_id, file_number, property_address, amount, direction, posted_on, source, memo, category, idempotency_key, actor, created_at',
    )
    .order('posted_on', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(500)

  if (query.leadId) request = request.eq('lead_id', query.leadId)
  if (query.fileNumber) request = request.eq('file_number', query.fileNumber)
  if (query.tcFileId) request = request.eq('tc_file_id', query.tcFileId)

  const { data, error } = await request
  if (error) {
    if (['42P01', 'PGRST205'].includes(error.code ?? '')) {
      throw new DealLedgerError('Deal File ledger is unavailable.', 'unavailable', 503)
    }
    throw new DealLedgerError('Deal File ledger could not be read.', 'unavailable', 503)
  }

  return (data ?? []).flatMap((row) => {
    const line = asLine(row)
    return line ? [line] : []
  })
}
