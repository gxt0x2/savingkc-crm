import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stableWebhookActivityId } from '@/lib/telephony/webhook-idempotency'
import {
  evaluateOutboundDialerCall,
  recordBlockedDialerCall,
  type OutboundDialerCallDecision,
  type OutboundDialerCallInput,
} from './dialer-call-eligibility'

type Row = Record<string, unknown>
type DbState = {
  rows: Record<string, Row[]>
  errors?: Set<string>
  inserts: Array<{ table: string; payload: Row }>
}

class Query implements PromiseLike<{ data: Row[]; error: { message: string; code?: string } | null }> {
  private filters: Array<(row: Row) => boolean> = []
  private maxRows: number | null = null

  constructor(private readonly table: string, private readonly state: DbState) {}

  select() { return this }
  order() { return this }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }
  in(column: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }
  limit(value: number) {
    this.maxRows = value
    return this
  }
  async maybeSingle() {
    const result = this.result()
    return { data: result.data[0] ?? null, error: result.error }
  }
  async insert(payload: Row) {
    this.state.inserts.push({ table: this.table, payload })
    return { data: null, error: this.state.errors?.has(`${this.table}:insert`) ? { message: 'insert failed' } : null }
  }
  then<TResult1 = { data: Row[]; error: { message: string; code?: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: { message: string; code?: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected)
  }

  private result() {
    if (this.state.errors?.has(this.table)) {
      return { data: [], error: { message: `${this.table} failed` } }
    }
    let rows = [...(this.state.rows[this.table] ?? [])].filter((row) => this.filters.every((filter) => filter(row)))
    if (this.maxRows != null) rows = rows.slice(0, this.maxRows)
    return { data: rows, error: null }
  }
}

function database(rows: Record<string, Row[]> = {}, errors: string[] = []) {
  const state: DbState = { rows, errors: new Set(errors), inserts: [] }
  const client = {
    from: vi.fn((table: string) => new Query(table, state)),
  } as unknown as SupabaseClient
  return { client, state }
}

const baseInput: OutboundDialerCallInput = {
  phone: '+19135550123',
  leadId: 'lead-1',
  prospectPhoneId: null,
  source: 'web_power_dialer',
  identity: 'casey',
  callerId: '+18167277667',
  clientAttemptId: 'attempt-1',
  now: new Date('2026-08-17T17:00:00.000Z'),
}

function goodLead(extra: Row = {}): Row {
  return {
    id: 'lead-1',
    phone: '+19135550123',
    station: 'new',
    classification: 'lead',
    ...extra,
  }
}

describe('server dialer call eligibility', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('allows a verified lead context when every durable source is clean', async () => {
    const db = database({ leads: [goodLead()] })

    const result = await evaluateOutboundDialerCall(baseInput, { db: db.client })

    expect(result).toMatchObject({ allowed: true, normalizedPhone: '+19135550123', leadId: 'lead-1' })
    expect(db.client.from).not.toHaveBeenCalledWith('manifests')
  })

  it('fails closed when any policy query is unavailable', async () => {
    const db = database({ leads: [goodLead()] }, ['sms_opt_outs'])

    const result = await evaluateOutboundDialerCall(baseInput, { db: db.client })

    expect(result).toMatchObject({ allowed: false, reason: 'policy_unavailable', reasonSource: 'policy_runtime' })
  })

  it('fails closed on a bounded timeout instead of hanging the provider request', async () => {
    const never = new Promise<never>(() => {})
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'limit', 'order']) chain[method] = () => chain
    chain.maybeSingle = () => never
    chain.then = never.then.bind(never)
    const client = { from: () => chain } as unknown as SupabaseClient

    const result = await evaluateOutboundDialerCall(baseInput, { db: client, timeoutMs: 5 })

    expect(result).toMatchObject({ allowed: false, reason: 'policy_unavailable', reasonSource: 'policy_runtime' })
  })

  it('rejects an untrusted lead context whose stored destination does not match', async () => {
    const db = database({ leads: [goodLead({ phone: '+19135550999' })] })

    const result = await evaluateOutboundDialerCall(baseInput, { db: db.client })

    expect(result).toMatchObject({ allowed: false, reason: 'destination_mismatch', reasonSource: 'lead_context' })
  })

  it('lets any matching duplicate terminal record win', async () => {
    const db = database({
      leads: [goodLead(), goodLead({ id: 'lead-2', classification: 'dead' })],
    })

    const result = await evaluateOutboundDialerCall(baseInput, { db: db.client })

    expect(result).toMatchObject({ allowed: false, reason: 'dead_lead', reasonSource: 'leads.classification' })
  })

  it('blocks the known team destinations even when phone overrides are absent', async () => {
    vi.stubEnv('ERNEST_PHONE', '')
    vi.stubEnv('CASEY_PHONE', '')
    const db = database()

    const result = await evaluateOutboundDialerCall({
      ...baseInput,
      phone: '+18162262552',
      leadId: null,
    }, { db: db.client })

    expect(result).toMatchObject({
      allowed: false,
      reason: 'internal_destination',
      reasonSource: 'internal_numbers',
    })
  })

  it('only applies activity stop outcomes to the target phone', async () => {
    const db = database({
      leads: [goodLead()],
      lead_activities: [
        { lead_id: 'lead-1', activity_type: 'call', metadata: { phone: '+19135550999', disposition: 'dnc' }, created_at: '2026-08-17T16:00:00Z' },
        { lead_id: 'lead-1', activity_type: 'call', metadata: { phone: '+19135550123', disposition: 'no_answer' }, created_at: '2026-08-17T15:00:00Z' },
      ],
    })

    expect(await evaluateOutboundDialerCall(baseInput, { db: db.client })).toMatchObject({ allowed: true })

    db.state.rows.lead_activities.push({
      lead_id: 'lead-1',
      activity_type: 'call',
      metadata: { phone: '+19135550123', outcome: 'bad_number' },
      created_at: '2026-08-17T17:00:00Z',
    })
    expect(await evaluateOutboundDialerCall(baseInput, { db: db.client })).toMatchObject({
      allowed: false,
      reason: 'disconnected',
      reasonSource: 'lead_activities.metadata.outcome',
    })
  })

  it('uses durable suppression for an heir without consulting Manifest', async () => {
    const heirInput = {
      ...baseInput,
      phone: '+19135550777',
      prospectPhoneId: 'prospect-phone-1',
      source: 'web_heir_dialer' as const,
    }
    const db = database({
      leads: [goodLead()],
      prospect_phones: [{
        id: 'prospect-phone-1',
        phone: '+19135550777',
        prospect_id: 'prospect-1',
        phone_connected: null,
        last_disposition: null,
        prospects: { lead_id: 'lead-1' },
      }],
    })

    expect(await evaluateOutboundDialerCall(heirInput, { db: db.client })).toMatchObject({ allowed: true })

    db.state.rows.sms_opt_outs = [{ phone: '+19135550777', reason: 'STOP', is_opted_out: true }]
    expect(await evaluateOutboundDialerCall(heirInput, { db: db.client })).toMatchObject({
      allowed: false,
      reason: 'do_not_call',
      reasonSource: 'sms_opt_outs.reason',
    })
    expect(db.client.from).not.toHaveBeenCalledWith('manifests')
  })

  it('authorizes only the exact associated phone for an unpromoted source Prospect', async () => {
    const sourceInput: OutboundDialerCallInput = {
      ...baseInput,
      phone: '+19135550777',
      leadId: null,
      prospectId: 'prospect-1',
      prospectPhoneId: 'prospect-phone-1',
      source: 'web_heir_dialer',
    }
    const db = database({
      prospect_phones: [{
        id: 'prospect-phone-1',
        phone: '+19135550777',
        prospect_id: 'prospect-1',
        phone_connected: null,
        last_disposition: null,
        prospects: { lead_id: null },
      }],
    })

    expect(await evaluateOutboundDialerCall(sourceInput, { db: db.client })).toMatchObject({
      allowed: true,
      leadId: null,
      prospectId: 'prospect-1',
      prospectPhoneId: 'prospect-phone-1',
    })
    expect(await evaluateOutboundDialerCall({ ...sourceInput, prospectId: 'prospect-2' }, { db: db.client })).toMatchObject({
      allowed: false,
      reason: 'destination_mismatch',
      reasonSource: 'prospect_phone_context',
    })
  })

  it('writes a deterministic blocked audit using the client attempt before the provider SID', async () => {
    const db = database()
    const result: OutboundDialerCallDecision = {
      allowed: false,
      normalizedPhone: '+19135550123',
      reason: 'do_not_call',
      message: 'This number is on the do-not-call list.',
      policyVersion: 'dialer_safety_v1',
      checkedAt: '2026-08-17T17:00:00.000Z',
      leadId: 'lead-1',
      prospectId: null,
      prospectPhoneId: null,
      reasonSource: 'sms_opt_outs.reason',
    }

    await recordBlockedDialerCall({ ...baseInput, callSid: 'CA_provider' }, result, { db: db.client })

    expect(db.state.inserts).toHaveLength(1)
    expect(db.state.inserts[0]).toMatchObject({
      table: 'lead_activities',
      payload: {
        id: stableWebhookActivityId('outbound-call-blocked', 'attempt-1'),
        lead_id: 'lead-1',
        activity_type: 'call',
        agent: 'casey',
        metadata: {
          source: 'outbound_call_policy',
          policy_version: 'dialer_safety_v1',
          reason_code: 'do_not_call',
          reason_source: 'sms_opt_outs.reason',
          client_attempt_id: 'attempt-1',
          call_sid: 'CA_provider',
        },
      },
    })
  })
})
