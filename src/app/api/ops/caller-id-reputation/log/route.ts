import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
const MAX_ROWS = 50
const MAX_RAW_CHARS = 20_000

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
const count = z.number().int().min(0).max(1_000_000).nullable().optional()
const rate = z.number().finite().min(0).nullable().optional()

const rowSchema = z.object({
  checked_at: z.string().datetime({ offset: true }).optional(),
  check_slot: z.enum(['am', 'pm', 'adhoc']).nullable().optional(),
  phone_e164: z.string().trim().min(1).max(32),
  number_label: optionalText(120),
  mojo_verified: z.boolean().nullable().optional(),
  reputation_guard_status: optionalText(80),
  voice_integrity_attached: z.boolean().nullable().optional(),
  last_attestation: z.enum(['A', 'B', 'C', 'none']).nullable().optional(),
  dials_today: count,
  connect_rate: rate,
  connect_rate_5d: rate,
  short_call_share: rate,
  flag_reason: optionalText(500),
  action_taken: optionalText(500),
  action_result: optionalText(500),
  rotation_state: z.enum(['active', 'resting']).nullable().optional(),
  consecutive_clean: count,
  fix_attempts: count,
  decision_needed: z.boolean().optional(),
  notes: optionalText(2000),
  raw: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict().refine((row) => {
  if (row.raw == null) return true
  try {
    return JSON.stringify(row.raw).length <= MAX_RAW_CHARS
  } catch {
    return false
  }
}, { path: ['raw'], message: 'raw is too large' })

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1).max(MAX_ROWS),
}).strict()

type ReputationRow = {
  id: string
  phone_e164: string
  checked_at: string
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

function configuredSecret(): string | null {
  const secret = process.env.CALLER_ID_LOG_SECRET?.trim()
  return secret || null
}

function bearerToken(request: Request): string | null {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function secretsMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
}

function authorize(request: Request) {
  const expected = configuredSecret()
  if (!expected) return json({ error: 'Caller ID reputation log is not configured' }, 503)
  const supplied = bearerToken(request)
  if (!supplied || !secretsMatch(supplied, expected)) return json({ error: 'Unauthorized' }, 401)
  return null
}

function checkedAtMillis(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isNewer(candidate: ReputationRow, current: ReputationRow): boolean {
  const candidateAt = checkedAtMillis(candidate.checked_at)
  const currentAt = checkedAtMillis(current.checked_at)
  if (candidateAt !== currentAt) return candidateAt > currentAt
  return candidate.id > current.id
}

function latestPerNumber<T extends ReputationRow>(rows: T[]): T[] {
  const latest = new Map<string, T>()
  for (const row of rows) {
    const current = latest.get(row.phone_e164)
    if (!current || isNewer(row, current)) latest.set(row.phone_e164, row)
  }
  return [...latest.values()].sort((left, right) => left.phone_e164.localeCompare(right.phone_e164))
}

function unavailable(error: { code?: string }) {
  return error.code === '42P01' || error.code === 'PGRST205'
}

export async function POST(request: Request) {
  const unauthorized = authorize(request)
  if (unauthorized) return unauthorized

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ error: 'Invalid caller ID reputation log' }, 400)

  const receivedAt = new Date().toISOString()
  const rows = []
  for (const [index, row] of parsed.data.rows.entries()) {
    const phone = normalizePhoneToE164(row.phone_e164)
    if (!phone) return json({ error: 'Invalid caller ID reputation log', index }, 400)
    rows.push({
      checked_at: row.checked_at ?? receivedAt,
      check_slot: row.check_slot ?? null,
      phone_e164: phone,
      number_label: row.number_label ?? null,
      mojo_verified: row.mojo_verified ?? null,
      reputation_guard_status: row.reputation_guard_status ?? null,
      voice_integrity_attached: row.voice_integrity_attached ?? null,
      last_attestation: row.last_attestation ?? null,
      dials_today: row.dials_today ?? null,
      connect_rate: row.connect_rate ?? null,
      connect_rate_5d: row.connect_rate_5d ?? null,
      short_call_share: row.short_call_share ?? null,
      flag_reason: row.flag_reason ?? null,
      action_taken: row.action_taken ?? null,
      action_result: row.action_result ?? null,
      rotation_state: row.rotation_state ?? null,
      consecutive_clean: row.consecutive_clean ?? null,
      fix_attempts: row.fix_attempts ?? null,
      decision_needed: row.decision_needed ?? false,
      notes: row.notes ?? null,
      raw: row.raw ?? null,
    })
  }

  const { data, error } = await supabaseAdmin()
    .from('caller_id_reputation_log')
    .insert(rows)
    .select('id')

  if (error || !data?.length) {
    console.error('[caller-id-reputation] insert failed', { code: error?.code ?? 'empty' })
    return json(
      { error: error && unavailable(error) ? 'Caller ID reputation log is unavailable' : 'Caller ID reputation log was not saved' },
      error && unavailable(error) ? 503 : 500,
    )
  }

  return json({ ok: true, inserted: data.length, ids: data.map((row: { id: string }) => row.id) }, 201)
}

export async function GET(request: Request) {
  const unauthorized = authorize(request)
  if (unauthorized) return unauthorized

  const { data, error } = await supabaseAdmin()
    .from('caller_id_reputation_latest')
    .select('*')
    .order('checked_at', { ascending: false })

  if (error) {
    console.error('[caller-id-reputation] read failed', { code: error.code })
    return json(
      { error: unavailable(error) ? 'Caller ID reputation log is unavailable' : 'Caller ID reputation log could not be read' },
      unavailable(error) ? 503 : 500,
    )
  }

  const numbers = latestPerNumber((data ?? []) as ReputationRow[])
  return json({ ok: true, numbers })
}
