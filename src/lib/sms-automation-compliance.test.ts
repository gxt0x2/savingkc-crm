import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const harness = vi.hoisted(() => {
  const state = {
    optOuts: [] as Row[],
    leads: [] as Row[],
    methods: [] as Row[],
    activities: [] as Row[],
    errors: new Set<string>(),
  }

  function rowsFor(table: string): Row[] {
    if (table === 'sms_opt_outs') return state.optOuts
    if (table === 'leads') return state.leads
    if (table === 'crm_contact_methods') return state.methods
    if (table === 'lead_activities') return state.activities
    return []
  }

  function valueAt(row: Row, column: string): unknown {
    if (column === 'metadata->>from') {
      const metadata = row.metadata as Record<string, unknown> | undefined
      return metadata?.from
    }
    return row[column]
  }

  function builder(table: string) {
    const filters: Array<(row: Row) => boolean> = []
    let limitCount = 100
    let mode: 'select' | 'insert' | 'upsert' = 'select'
    let payload: Row | null = null

    const run = (single: boolean) => {
      if (state.errors.has(table)) return Promise.resolve({ data: null, error: { message: 'database unavailable' } })
      if (mode === 'upsert' && payload) {
        const phone = String(payload.phone)
        const index = state.optOuts.findIndex((row) => row.phone === phone)
        if (index >= 0) state.optOuts[index] = { ...state.optOuts[index], ...payload }
        else state.optOuts.push({ ...payload })
        return Promise.resolve({ error: null })
      }
      if (mode === 'insert' && payload) {
        rowsFor(table).push({ ...payload })
        return Promise.resolve({ error: null })
      }
      const rows = rowsFor(table).filter((row) => filters.every((filter) => filter(row))).slice(0, limitCount)
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null })
    }

    const api = {
      select() { return api },
      insert(row: Row) { mode = 'insert'; payload = row; return api },
      upsert(row: Row) { mode = 'upsert'; payload = row; return api },
      eq(column: string, value: unknown) {
        filters.push((row) => valueAt(row, column) === value)
        return api
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(valueAt(row, column)))
        return api
      },
      order() { return api },
      limit(count: number) { limitCount = count; return api },
      maybeSingle() { return run(true) },
      single() { return run(true) },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return run(false).then(resolve, reject)
      },
    }
    return api
  }

  return { state, builder }
})

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: (table: string) => harness.builder(table) },
}))

import { processInboundSmsConsent } from './sms-consent-audit'
import { automatedSmsBlockReason } from './sms-send-gate'

const PHONE = '+18164334092'
const LEAD_ID = 'e82346ae-f66b-4001-adf7-454f6734015a'

function seedLead(deadReason: string | null = null) {
  harness.state.leads.push({ id: LEAD_ID, phone: PHONE, dead_reason: deadReason })
}

async function deliverColdCallbackAutoText() {
  const send = vi.fn(async () => undefined)
  try {
    const reason = await automatedSmsBlockReason({ phone: PHONE, leadId: LEAD_ID })
    if (reason) return { trigger: 'cold_callback_auto_text' as const, sent: false, reason, send }
    await send()
    return { trigger: 'cold_callback_auto_text' as const, sent: true, reason: null, send }
  } catch {
    return { trigger: 'cold_callback_auto_text' as const, sent: false, reason: 'unverified' as const, send }
  }
}

describe('INC-2026-09-22-001 automated SMS suppression', () => {
  beforeEach(() => {
    harness.state.optOuts.length = 0
    harness.state.leads.length = 0
    harness.state.methods.length = 0
    harness.state.activities.length = 0
    harness.state.errors.clear()
    seedLead()
  })

  it('records exact STOP and blocks cold_callback_auto_text', async () => {
    await expect(processInboundSmsConsent({
      from: PHONE,
      to: '+18163077835',
      keyword: 'STOP',
      messageSid: 'SM-stop',
      source: 'twilio_sms_webhook',
    })).resolves.toContain('unsubscribed')

    expect(harness.state.optOuts).toEqual([
      expect.objectContaining({ phone: PHONE, is_opted_out: true, reason: 'STOP' }),
    ])
    const delivery = await deliverColdCallbackAutoText()
    expect(delivery).toMatchObject({ trigger: 'cold_callback_auto_text', sent: false, reason: 'opted_out' })
    expect(delivery.send).not.toHaveBeenCalled()
  })

  it('records natural-language opt-out and blocks cold_callback_auto_text', async () => {
    const keyword = 'Please stop texting me and take me off your list. This number is DND.'
    await expect(processInboundSmsConsent({
      from: PHONE,
      to: '+18163077835',
      keyword,
      messageSid: 'SM-nl',
      source: 'twilio_sms_webhook',
    })).resolves.toContain('unsubscribed')

    expect(harness.state.optOuts).toEqual([
      expect.objectContaining({ phone: PHONE, is_opted_out: true, reason: 'NATURAL_LANGUAGE_OPT_OUT' }),
    ])
    const delivery = await deliverColdCallbackAutoText()
    expect(delivery).toMatchObject({ trigger: 'cold_callback_auto_text', sent: false, reason: 'opted_out' })
    expect(delivery.send).not.toHaveBeenCalled()
  })

  it('still allows cold_callback_auto_text when the seller has not opted out', async () => {
    await expect(processInboundSmsConsent({
      from: PHONE,
      to: '+18163077835',
      keyword: 'Yes I might want to sell',
      messageSid: 'SM-yes',
      source: 'twilio_sms_webhook',
    })).resolves.toBeNull()

    expect(harness.state.optOuts).toEqual([])
    const delivery = await deliverColdCallbackAutoText()
    expect(delivery).toMatchObject({ trigger: 'cold_callback_auto_text', sent: true, reason: null })
    expect(delivery.send).toHaveBeenCalledOnce()
  })

  it('fail-closes when consent is unknown but a prior inbound already asked to stop', async () => {
    harness.state.activities.push({
      lead_id: LEAD_ID,
      activity_type: 'sms',
      description: 'Do not contact me anymore',
      created_at: '2026-09-22T15:00:00.000Z',
      metadata: { direction: 'received', from: PHONE },
    })

    const delivery = await deliverColdCallbackAutoText()
    expect(delivery).toMatchObject({ sent: false, reason: 'inbound_opt_out' })
    expect(delivery.send).not.toHaveBeenCalled()
    expect(harness.state.optOuts).toEqual([
      expect.objectContaining({ phone: PHONE, is_opted_out: true, reason: 'NATURAL_LANGUAGE_OPT_OUT' }),
    ])
  })

  it('does not treat an outbound STOP footer as inbound opt-out', async () => {
    harness.state.activities.push({
      lead_id: LEAD_ID,
      activity_type: 'sms',
      description: 'Reply STOP to opt out',
      created_at: '2026-09-22T15:00:00.000Z',
      metadata: { direction: 'outbound', to: PHONE },
    })

    const delivery = await deliverColdCallbackAutoText()
    expect(delivery.sent).toBe(true)
    expect(harness.state.optOuts).toEqual([])
  })

  it('blocks when contact consent is opted out even without an sms_opt_outs row', async () => {
    harness.state.methods.push({
      method_type: 'phone',
      normalized_value: PHONE,
      sms_consent_status: 'opted_out',
      consent_observed_at: '2026-09-22T16:00:00.000Z',
    })

    await expect(automatedSmsBlockReason({ phone: PHONE, leadId: LEAD_ID })).resolves.toBe('contact_opted_out')
  })

  it('blocks automated SMS to a DND lead without rewriting the lead', async () => {
    harness.state.leads[0].dead_reason = 'dnc_refused'
    await expect(automatedSmsBlockReason({ phone: PHONE, leadId: LEAD_ID })).resolves.toBe('dnd')
    expect(harness.state.leads[0]).toMatchObject({ id: LEAD_ID, dead_reason: 'dnc_refused' })
  })

  it('does not send when suppression status cannot be verified', async () => {
    harness.state.errors.add('sms_opt_outs')
    const delivery = await deliverColdCallbackAutoText()
    expect(delivery).toMatchObject({ sent: false, reason: 'unverified' })
    expect(delivery.send).not.toHaveBeenCalled()
  })
})
