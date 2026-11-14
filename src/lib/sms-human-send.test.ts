import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const harness = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Row[]>,
    errors: new Set<string>(),
    rpcError: false,
    rpcReason: null as string | null,
    inserts: [] as Row[],
  }

  function valueAt(row: Row, column: string): unknown {
    if (column.startsWith('metadata->>')) {
      const metadata = row.metadata as Record<string, unknown> | undefined
      return metadata?.[column.slice('metadata->>'.length)]
    }
    return row[column]
  }

  function builder(table: string) {
    const filters: Array<(row: Row) => boolean> = []
    let limitCount = 1000
    let mode: 'select' | 'insert' = 'select'
    let payload: Row | null = null

    const run = (single: boolean) => {
      if (state.errors.has(table)) return Promise.resolve({ data: null, error: { message: 'database unavailable' } })
      if (!Object.prototype.hasOwnProperty.call(state.tables, table)) {
        return Promise.resolve({
          data: null,
          error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` },
        })
      }
      if (mode === 'insert' && payload) {
        state.tables[table].push({ ...payload })
        state.inserts.push({ ...payload })
        return Promise.resolve({ error: null })
      }
      const rows = state.tables[table].filter((row) => filters.every((filter) => filter(row))).slice(0, limitCount)
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null })
    }

    const api = {
      select() { return api },
      insert(row: Row) { mode = 'insert'; payload = row; return api },
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
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return run(false).then(resolve, reject)
      },
    }
    return api
  }

  return { state, builder }
})

const actualSafe = vi.hoisted(() => ({
  current: null as null | typeof import('@/lib/safe-communications'),
}))

const mocks = vi.hoisted(() => ({
  safeSendSMS: vi.fn(),
  isDuplicateSms: vi.fn(),
  logSmsSend: vi.fn(),
  checkAutoAdvance: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from: (table: string) => harness.builder(table),
    rpc: async (name: string) => {
      if (name !== 'source_list_phone_block_reason_v1') {
        return { data: null, error: { message: `unexpected rpc ${name}` } }
      }
      if (harness.state.rpcError) return { data: null, error: { message: 'database unavailable' } }
      return { data: harness.state.rpcReason, error: null }
    },
  },
}))

vi.mock('@/lib/safe-communications', async () => {
  const actual = await vi.importActual<typeof import('@/lib/safe-communications')>('@/lib/safe-communications')
  actualSafe.current = actual
  return {
    ...actual,
    safeSendSMS: mocks.safeSendSMS,
  }
})

vi.mock('@/lib/sms-dedup', () => ({
  isDuplicateSms: mocks.isDuplicateSms,
  logSmsSend: mocks.logSmsSend,
}))

vi.mock('@/lib/pipeline-auto-advance', () => ({ checkAutoAdvance: mocks.checkAutoAdvance }))

import { HUMAN_1TO1_SMS_TEMPLATE_ID, sendLeadSms } from './send-lead-sms'
import { isWithinRecipientSmsHours } from './sms-quiet-hours'

const CENTRAL = '+18165550199'
const PACIFIC = '+14155550199'
const FROM = '+18166088552'
const TWO_PM_CENTRAL = new Date('2026-11-14T20:00:00.000Z')
const EIGHT_FIFTY_NINE_PM_CENTRAL = new Date('2026-11-15T02:59:00.000Z')
const NINE_PM_CENTRAL = new Date('2026-11-15T03:00:00.000Z')
const SEVEN_THIRTY_AM_PACIFIC = new Date('2026-11-14T15:30:00.000Z')

function resetTables() {
  harness.state.tables = {
    sms_opt_outs: [],
    prospect_phones: [],
    prospects: [],
    crm_contact_methods: [],
    leads: [],
    crm_mojo_call_events: [],
    lead_activities: [],
  }
  harness.state.errors.clear()
  harness.state.rpcError = false
  harness.state.rpcReason = null
  harness.state.inserts = []
}

function send(phone: string, now: Date, extra: { leadId?: string | null; templateId?: string } = {}) {
  return sendLeadSms({
    leadId: extra.leadId === undefined ? 'lead-1' : extra.leadId,
    phone,
    body: 'Checking in about the property',
    fromPhone: FROM,
    agent: 'Ernest',
    templateId: extra.templateId ?? HUMAN_1TO1_SMS_TEMPLATE_ID,
    humanSession: { userId: 'user-ernest' },
    now,
  })
}

describe('human 1:1 SMS quiet hours, DNC, and cold registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    resetTables()
    mocks.isDuplicateSms.mockResolvedValue(false)
    mocks.logSmsSend.mockResolvedValue(undefined)
    mocks.checkAutoAdvance.mockResolvedValue(undefined)
    mocks.safeSendSMS.mockImplementation(async (params) => {
      const actual = actualSafe.current
      if (!actual) throw new Error('safe communications mock was not ready')
      if (params.templateId !== actual.HUMAN_1TO1_SMS_TEMPLATE_ID) return actual.safeSendSMS(params)
      return {
        success: true,
        sid: 'SM-human',
        from: FROM,
        to: params.to,
        body: params.body,
        requestedFrom: FROM,
        senderMismatch: false,
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends a clean number at 2pm recipient-local and logs the cold consent basis', async () => {
    const result = await send(CENTRAL, TWO_PM_CENTRAL)

    expect(result).toMatchObject({ status: 'sent', sid: 'SM-human', from: FROM, persisted: true })
    expect(mocks.safeSendSMS).toHaveBeenCalledWith(expect.objectContaining({
      to: CENTRAL,
      templateId: HUMAN_1TO1_SMS_TEMPLATE_ID,
    }))
    expect(harness.state.inserts).toEqual([
      expect.objectContaining({
        lead_id: 'lead-1',
        agent: 'Ernest',
        description: 'Checking in about the property',
        metadata: expect.objectContaining({
          consent_basis: 'owner_accepted_cold_1to1',
          sender_line: FROM,
          registry_status: 'not_loaded',
          direction: 'outbound',
          from: FROM,
        }),
      }),
    ])
  })

  it('allows 8:59pm recipient-local and refuses 9:00pm', async () => {
    await expect(send(CENTRAL, EIGHT_FIFTY_NINE_PM_CENTRAL)).resolves.toMatchObject({ status: 'sent' })
    expect(mocks.safeSendSMS).toHaveBeenCalledTimes(1)

    mocks.safeSendSMS.mockClear()
    harness.state.inserts = []
    const refused = await send(CENTRAL, NINE_PM_CENTRAL)

    expect(refused).toMatchObject({ status: 'refused', code: 'sms_quiet_hours' })
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
    expect(harness.state.inserts).toEqual([])
  })

  it('refuses a Pacific number at 7:30am PT while Central is already inside the window', async () => {
    const pacific = await send(PACIFIC, SEVEN_THIRTY_AM_PACIFIC)
    expect(pacific).toMatchObject({ status: 'refused', code: 'sms_quiet_hours' })
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()

    const central = await send(CENTRAL, SEVEN_THIRTY_AM_PACIFIC)
    expect(central).toMatchObject({ status: 'sent' })
  })

  it('uses the narrower window for a ported area code and 10am–8pm Central when the zone is unknown', () => {
    const eightThirtyCentral = new Date('2026-11-14T14:30:00.000Z')
    const nineThirtyCentral = new Date('2026-11-14T15:30:00.000Z')
    const tenCentral = new Date('2026-11-14T16:00:00.000Z')
    const eightPmCentral = new Date('2026-11-15T02:00:00.000Z')
    const eightAmCentral = new Date('2026-11-14T14:00:00.000Z')
    const sevenFiftyNineCentral = new Date('2026-11-14T13:59:00.000Z')

    expect(isWithinRecipientSmsHours('+16055550199', eightThirtyCentral)).toBe(false)
    expect(isWithinRecipientSmsHours('+16055550199', nineThirtyCentral)).toBe(true)
    expect(isWithinRecipientSmsHours('+19995550199', nineThirtyCentral)).toBe(false)
    expect(isWithinRecipientSmsHours('+19995550199', tenCentral)).toBe(true)
    expect(isWithinRecipientSmsHours('+19995550199', eightPmCentral)).toBe(false)
    expect(isWithinRecipientSmsHours(CENTRAL, eightAmCentral)).toBe(true)
    expect(isWithinRecipientSmsHours(CENTRAL, sevenFiftyNineCentral)).toBe(false)
  })

  it('refuses a cold dataskip_dnc number and allows a warm thread to that same number', async () => {
    harness.state.tables.prospect_phones.push({
      phone: CENTRAL,
      phone_connected: 'dataskip_dnc',
      last_disposition: null,
      voice_hold: false,
    })

    const cold = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(cold).toMatchObject({ status: 'refused', code: 'sms_registry_dnc' })
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()

    harness.state.tables.lead_activities.push({
      lead_id: 'lead-1',
      activity_type: 'sms',
      description: 'Yes, this is my number',
      created_at: '2026-11-01T15:00:00.000Z',
      metadata: { direction: 'received', from: CENTRAL },
    })
    const warm = await send(CENTRAL, TWO_PM_CENTRAL)

    expect(warm).toMatchObject({ status: 'sent' })
    expect(harness.state.inserts).toEqual([
      expect.objectContaining({
        metadata: expect.not.objectContaining({ consent_basis: 'owner_accepted_cold_1to1' }),
      }),
    ])
  })

  it('refuses a cold send when a federal registry table has the number and still allows a warm thread', async () => {
    harness.state.tables.federal_dnc_registry = [{ phone: '8165550199' }]

    const cold = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(cold).toMatchObject({ status: 'refused', code: 'sms_registry_dnc' })
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()

    harness.state.tables.lead_activities.push({
      lead_id: 'lead-1',
      activity_type: 'sms',
      description: 'Call me tomorrow',
      created_at: '2026-11-02T15:00:00.000Z',
      metadata: { direction: 'inbound', from: CENTRAL, consent: true },
    })
    await expect(send(CENTRAL, TWO_PM_CENTRAL)).resolves.toMatchObject({ status: 'sent' })
  })

  it('refuses an sms_opt_outs STOP', async () => {
    harness.state.tables.sms_opt_outs.push({
      phone: CENTRAL,
      is_opted_out: true,
      reason: 'STOP',
    })

    const result = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(result).toMatchObject({ status: 'refused', code: 'sms_dnc_blocked' })
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
  })

  it('refuses when any prospect_phones row for the number is dnc_number', async () => {
    harness.state.tables.prospect_phones.push(
      { phone: CENTRAL, phone_connected: 'connected', last_disposition: null, voice_hold: false },
      { phone: '(816) 555-0199', phone_connected: null, last_disposition: 'dnc_number', voice_hold: false },
    )

    const result = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(result).toMatchObject({ status: 'refused', code: 'sms_dnc_blocked' })
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
  })

  it('refuses a lead whose dead_reason is dnc_refused', async () => {
    harness.state.tables.leads.push({
      id: 'lead-1',
      phone: CENTRAL,
      dead_reason: 'dnc_refused',
      call_result: null,
    })

    const result = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(result).toMatchObject({ status: 'refused', code: 'sms_dnc_blocked' })
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
  })

  it('refuses a Mojo DNC outcome and keeps wrong-number as a warning', async () => {
    harness.state.tables.crm_mojo_call_events.push({
      normalized_phone: CENTRAL,
      outcome: 'dnc',
      disposition_raw: 'take_me_off',
    })
    const blocked = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(blocked).toMatchObject({ status: 'refused', code: 'sms_dnc_blocked' })

    harness.state.tables.crm_mojo_call_events.length = 0
    harness.state.tables.prospect_phones.push({
      phone: CENTRAL,
      phone_connected: 'wrong_number',
      last_disposition: null,
      voice_hold: false,
    })
    const warned = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(warned).toMatchObject({
      status: 'sent',
      warning: expect.stringContaining('wrong_number'),
    })
    expect(harness.state.inserts.at(-1)).toMatchObject({
      metadata: expect.objectContaining({
        consent_basis: 'owner_accepted_cold_1to1',
        phone_warnings: ['wrong_number'],
      }),
    })
  })

  it('fails closed when the DNC lookup errors', async () => {
    harness.state.rpcError = true

    const result = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(result).toMatchObject({
      status: 'refused',
      code: 'sms_dnc_blocked',
      error: expect.stringContaining('could not be verified'),
    })
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
  })

  it('keeps a later text cold after owner_accepted_cold_1to1 and ignores a STOP reply', async () => {
    harness.state.tables.lead_activities.push({
      lead_id: 'lead-1',
      activity_type: 'sms',
      description: 'Checking in about the property',
      created_at: '2026-11-14T18:00:00.000Z',
      metadata: {
        direction: 'outbound',
        to: CENTRAL,
        consent_basis: 'owner_accepted_cold_1to1',
        sender_line: FROM,
      },
    })
    harness.state.tables.prospect_phones.push({
      phone: CENTRAL,
      phone_connected: 'dataskip_dnc',
      last_disposition: null,
      voice_hold: false,
    })

    const stillCold = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(stillCold).toMatchObject({ status: 'refused', code: 'sms_registry_dnc' })
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()

    harness.state.tables.lead_activities.push({
      lead_id: 'lead-1',
      activity_type: 'sms',
      description: 'STOP',
      created_at: '2026-11-14T19:00:00.000Z',
      metadata: { direction: 'received', from: CENTRAL },
    })
    const afterStop = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(afterStop).toMatchObject({ status: 'refused', code: 'sms_registry_dnc' })
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()

    harness.state.tables.lead_activities.length = 0
    harness.state.tables.lead_activities.push({
      lead_id: 'lead-1',
      activity_type: 'sms',
      description: 'Yes, text me',
      created_at: '2026-11-14T19:30:00.000Z',
      metadata: { direction: 'received', from: CENTRAL },
    })
    const replied = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(replied).toMatchObject({ status: 'sent' })
    expect(harness.state.inserts.at(-1)?.metadata).not.toHaveProperty('consent_basis')
    expect(harness.state.inserts.at(-1)?.metadata).not.toHaveProperty('registry_status')

    harness.state.tables.lead_activities.length = 0
    harness.state.tables.lead_activities.push({
      lead_id: 'lead-1',
      activity_type: 'sms',
      description: 'Checking in about the property',
      created_at: '2026-11-14T18:00:00.000Z',
      metadata: { direction: 'outbound', to: CENTRAL, consent_basis: 'written_opt_in' },
    })
    const documented = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(documented).toMatchObject({ status: 'sent' })
    expect(harness.state.inserts.at(-1)?.metadata).not.toHaveProperty('consent_basis')
  })

  it('blocks every phone of a person, and every phone on the property when the owner is DNC', async () => {
    const sibling = '+18165550200'
    const blockedPhone = '+18165550111'

    async function sendSibling() {
      mocks.safeSendSMS.mockClear()
      harness.state.inserts = []
      return send(sibling, TWO_PM_CENTRAL)
    }

    function seed(phones: Row[], lead: Row | null = null) {
      resetTables()
      harness.state.tables.prospects.push({ id: 'pros-1', lead_id: 'lead-1', owner_1: 'Ada Owner' })
      harness.state.tables.prospect_phones.push(...phones)
      if (lead) harness.state.tables.leads.push(lead)
    }

    seed([
      { prospect_id: 'pros-1', phone: blockedPhone, contact_name: 'Ada Owner', relationship: 'relative', last_disposition: 'dnc_contact', voice_hold: false, phone_connected: null },
      { prospect_id: 'pros-1', phone: sibling, contact_name: 'Ada Owner', relationship: 'relative', last_disposition: null, voice_hold: false, phone_connected: null },
    ])
    expect(await sendSibling()).toMatchObject({ status: 'refused', code: 'sms_dnc_blocked' })

    seed([
      { prospect_id: 'pros-1', phone: blockedPhone, contact_name: 'Ada Owner', relationship: 'relative', last_disposition: 'take_me_off', voice_hold: false, phone_connected: null },
      { prospect_id: 'pros-1', phone: sibling, contact_name: 'Ada Owner', relationship: 'relative', last_disposition: null, voice_hold: false, phone_connected: null },
    ])
    expect(await sendSibling()).toMatchObject({ status: 'refused', code: 'sms_dnc_blocked' })

    seed([
      { prospect_id: 'pros-1', phone: blockedPhone, contact_name: 'Ada Owner', relationship: 'relative', last_disposition: 'dnc', voice_hold: false, phone_connected: null },
      { prospect_id: 'pros-1', phone: sibling, contact_name: 'Ada Owner', relationship: 'relative', last_disposition: null, voice_hold: false, phone_connected: null },
    ])
    expect(await sendSibling()).toMatchObject({ status: 'refused', code: 'sms_dnc_blocked' })

    seed([
      { prospect_id: 'pros-1', phone: blockedPhone, contact_name: 'Ada Owner', relationship: 'relative', last_disposition: null, voice_hold: false, phone_connected: null },
      { prospect_id: 'pros-1', phone: sibling, contact_name: 'Ada Owner', relationship: 'relative', last_disposition: null, voice_hold: false, phone_connected: null },
    ], {
      id: 'lead-1',
      phone: blockedPhone,
      full_name: 'Ada Owner',
      dead_reason: 'dnc_refused',
      call_result: null,
    })
    expect(await sendSibling()).toMatchObject({ status: 'refused', code: 'sms_dnc_blocked' })

    seed([
      { prospect_id: 'pros-1', phone: blockedPhone, contact_name: 'Ada Owner', relationship: 'owner', last_disposition: 'dnc_contact', voice_hold: false, phone_connected: null },
      { prospect_id: 'pros-1', phone: sibling, contact_name: 'Bea Heir', relationship: 'daughter', last_disposition: null, voice_hold: false, phone_connected: null },
    ])
    expect(await sendSibling()).toMatchObject({ status: 'refused', code: 'sms_dnc_blocked' })

    seed([
      { prospect_id: 'pros-1', phone: blockedPhone, contact_name: 'Cara Cousin', relationship: 'cousin', last_disposition: 'dnc_contact', voice_hold: false, phone_connected: null },
      { prospect_id: 'pros-1', phone: sibling, contact_name: 'Bea Heir', relationship: 'daughter', last_disposition: null, voice_hold: false, phone_connected: null },
    ])
    const otherPerson = await sendSibling()
    expect(otherPerson).toMatchObject({ status: 'sent' })
    expect(mocks.safeSendSMS).toHaveBeenCalled()
  })

  it('records registry_status checked when a registry table exists and not_loaded when none do', async () => {
    const missing = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(missing).toMatchObject({ status: 'sent' })
    expect(harness.state.inserts.at(-1)).toMatchObject({
      metadata: expect.objectContaining({ registry_status: 'not_loaded' }),
    })
    expect(JSON.stringify(harness.state.inserts.at(-1))).not.toMatch(/scrub/i)

    harness.state.tables.federal_dnc_registry = []
    harness.state.tables.mo_dnc_registry = []
    const checked = await send(CENTRAL, TWO_PM_CENTRAL)
    expect(checked).toMatchObject({ status: 'sent' })
    expect(harness.state.inserts.at(-1)).toMatchObject({
      metadata: expect.objectContaining({ registry_status: 'checked', consent_basis: 'owner_accepted_cold_1to1' }),
    })
  })

  it('still returns automated_sms_disabled for an automated template', async () => {
    const result = await send(CENTRAL, TWO_PM_CENTRAL, { templateId: 'sms.campaign.v1' })

    expect(result).toMatchObject({
      status: 'failed',
      code: 'automated_sms_disabled',
      error: expect.stringContaining('sms.conversation.1to1.v1'),
    })
    expect(harness.state.inserts).toEqual([])
    expect(mocks.safeSendSMS).toHaveBeenCalledWith(expect.objectContaining({ templateId: 'sms.campaign.v1' }))
  })
})
