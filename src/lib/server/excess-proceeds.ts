import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import { parseJacksonExcessProceedsCsv } from '@/lib/excess-proceeds/csv'
import { buildExcessProceedsPatch } from '@/lib/excess-proceeds/patch'
import { matchesExcessProceedsFilter, presentExcessProceedsFile, type ExcessProceedsRow } from '@/lib/excess-proceeds/present'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  EXCESS_PROCEEDS_LIST_LIMIT,
  chicagoToday,
  type ExcessProceedsFile,
  type ExcessProceedsFilter,
  type ExcessProceedsSort,
} from '@/types/excess-proceeds'

const FILE_COLUMNS = [
  'id', 'lead_id', 'track', 'county_source', 'suit_no', 'parcel_no', 'owner_name',
  'property_address', 'city', 'state', 'zip', 'sale_date', 'purchase_price', 'judgment_amount',
  'excess_amount', 'claim_deadline', 'confirmed_date', 'deed_date', 'set_aside_date', 'refund_date',
  'excess_application_filed_date', 'excess_denied_date', 'excess_paid_date', 'payout_ready',
  'zestimate', 'zestimate_as_of', 'score', 'owner_is_entity', 'counsel_status', 'form_pack_status',
  'form_pack_url', 'surplus_fee_pct',
  'leads(full_name, property_address, city, state, zip, phone, station)',
].join(', ')

export class ExcessProceedsError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'not_found' | 'unavailable',
    readonly status: number,
  ) {
    super(message)
  }
}

function compareNullableDesc(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return right - left
}

export async function listExcessProceedsFiles(query: {
  sort?: ExcessProceedsSort | null
  filter?: ExcessProceedsFilter | null
  today?: string
}): Promise<ExcessProceedsFile[]> {
  const today = query.today || chicagoToday()
  const { data, error } = await supabaseAdmin()
    .from('crm_excess_proceeds')
    .select(FILE_COLUMNS)
    .limit(EXCESS_PROCEEDS_LIST_LIMIT)

  if (error) {
    if (['42P01', 'PGRST205'].includes(error.code ?? '')) {
      throw new ExcessProceedsError('Excess-proceeds files are unavailable.', 'unavailable', 503)
    }
    throw new ExcessProceedsError('Excess-proceeds files could not be loaded.', 'unavailable', 503)
  }

  const files = ((data ?? []) as unknown as ExcessProceedsRow[])
    .map((row) => presentExcessProceedsFile(row, today))
    .filter((file) => matchesExcessProceedsFilter(file, query.filter || 'all'))

  const sort = query.sort === 'score' ? 'score' : 'excess_amount'
  files.sort((left, right) => compareNullableDesc(left[sort], right[sort]) || left.suit_no.localeCompare(right.suit_no))
  return files
}

export async function getExcessProceedsFile(leadId: string, today = chicagoToday()): Promise<ExcessProceedsFile | null> {
  const { data, error } = await supabaseAdmin()
    .from('crm_excess_proceeds')
    .select(FILE_COLUMNS)
    .eq('lead_id', leadId)
    .maybeSingle()
  if (error) {
    if (['42P01', 'PGRST205'].includes(error.code ?? '')) return null
    throw new ExcessProceedsError('Excess-proceeds file could not be loaded.', 'unavailable', 503)
  }
  if (!data) return null
  return presentExcessProceedsFile(data as unknown as ExcessProceedsRow, today)
}

export async function updateExcessProceedsFile(leadId: string, input: unknown): Promise<ExcessProceedsFile> {
  const command = buildExcessProceedsPatch(input)
  if (!command.ok) throw new ExcessProceedsError(command.error, 'invalid', 400)
  const { data, error } = await supabaseAdmin()
    .from('crm_excess_proceeds')
    .update(command.patch)
    .eq('lead_id', leadId)
    .select(FILE_COLUMNS)
    .maybeSingle()
  if (error) {
    if (error.message.includes('crm_excess_proceeds_zestimate_pair') || error.message.includes('invalid')) {
      throw new ExcessProceedsError('Zestimate needs both a value and an as-of date.', 'invalid', 400)
    }
    throw new ExcessProceedsError('Excess-proceeds file could not be saved.', 'unavailable', 503)
  }
  if (!data) throw new ExcessProceedsError('This Deal File is not on the excess-proceeds lane.', 'not_found', 404)
  return presentExcessProceedsFile(data as unknown as ExcessProceedsRow, chicagoToday())
}

export async function importJacksonExcessProceedsCsv(actor: AuthenticatedActor, csv: string) {
  const parsed = parseJacksonExcessProceedsCsv(csv)
  if (parsed.rows.length === 0 && parsed.errors.length === 0) {
    throw new ExcessProceedsError('The CSV is empty.', 'invalid', 400)
  }
  if (parsed.rows.length === 0) {
    throw new ExcessProceedsError(parsed.errors[0]?.message || 'No rows could be read.', 'invalid', 400)
  }
  const { data, error } = await supabaseAdmin().rpc('upsert_jackson_excess_proceeds_batch_v1', {
    target_rows: parsed.rows,
    target_actor: actor.email,
  })
  if (error) throw new ExcessProceedsError('Excess-proceeds import is unavailable.', 'unavailable', 503)
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  return {
    inserted: Number(payload.inserted ?? 0),
    updated: Number(payload.updated ?? 0),
    errors: [...parsed.errors, ...(Array.isArray(payload.errors) ? payload.errors : [])],
    warnings: parsed.warnings,
  }
}
