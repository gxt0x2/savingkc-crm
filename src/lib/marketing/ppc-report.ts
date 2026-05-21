import { PPC_TRACKING_PHONE_DIGITS } from '@/lib/call-quality-events'

export type PpcLeadRow = {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  source: string | null
  station: string | null
  priority: string | null
  property_address: string | null
  city: string | null
  created_at: string | null
  updated_at: string | null
  classification?: string | null
  opportunity_score?: number | null
}

export type PpcActivityRow = {
  id: string
  lead_id: string | null
  activity_type: string | null
  type?: string | null
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string | null
  agent?: string | null
}

export type PpcOutboxRow = {
  id: string
  event_name: string | null
  event_category: string | null
  dedupe_key?: string | null
  status: string | null
  optimization_role: string | null
  lead_id: string | null
  conversion_value: number | string | null
  event_time: string | null
  click_id: string | null
  click_id_type: string | null
  attribution: Record<string, unknown> | null
  payload: Record<string, unknown> | null
  attempts: number | null
  last_error: string | null
  sent_at: string | null
  created_at: string | null
}

export type PpcAppointmentRow = {
  id: string
  lead_id: string | null
  scheduled_at: string | null
  status: string | null
  source: string | null
  created_at: string | null
}

export type PpcRevenueRow = {
  id: string
  deal_id: string | null
  amount: number | string | null
  date: string | null
  source: string | null
}

export type PpcManifestRow = {
  lead_id: string | null
  manifest: Record<string, unknown> | null
  created_at: string | null
}

export type PpcReportInput = {
  days: number
  since: string
  until: string
  leads: PpcLeadRow[]
  activities: PpcActivityRow[]
  outbox: PpcOutboxRow[]
  appointments: PpcAppointmentRow[]
  revenue: PpcRevenueRow[]
  manifests: PpcManifestRow[]
}

export type PpcReport = {
  generatedAt: string
  period: {
    days: number
    since: string
    until: string
  }
  summary: {
    totalLeads: number
    formSubmits: number
    stage3NoSubmit: number
    callLeads: number
    connectedCalls: number
    call60s: number
    call2m: number
    call5m: number
    qualified: number
    appointments: number
    contracts: number
    revenue: number
    clickIdCoverageRate: number
    submitRate: number
    appointmentRate: number
    contractRate: number
  }
  funnel: Array<{
    key: string
    label: string
    count: number
    rateFromPrevious: number | null
    rateFromLead: number | null
  }>
  callQuality: Array<{
    key: string
    label: string
    count: number
    shareOfConnected: number | null
  }>
  attributionRows: Array<{
    key: string
    source: string
    medium: string
    campaign: string
    campaignId: string
    adGroupId: string
    keyword: string
    content: string
    leads: number
    formSubmits: number
    stage3NoSubmit: number
    callLeads: number
    appointments: number
    contracts: number
    revenue: number
    clickIds: number
  }>
  exportHealth: {
    total: number
    primary: number
    secondary: number
    pending: number
    sent: number
    failed: number
    deadLetter: number
    skipped: number
  }
  dataQuality: {
    clickIdCoverage: number
    attributionCoverage: number
    sourceMediumCoverage: number
    pendingExports: number
    failedExports: number
  }
  daily: Array<{
    date: string
    leads: number
    formSubmits: number
    ppcCalls: number
    appointments: number
  }>
  recentLeads: Array<{
    id: string
    name: string
    phone: string
    address: string
    stage: string
    createdAt: string | null
    lastSignalAt: string | null
    lastSignal: string
    formStatus: 'submitted' | 'stage_3_no_submit' | 'call_only' | 'lead_only'
    campaign: string
    keyword: string
    clickId: string
    callQuality: string
    revenue: number
  }>
}

type LeadState = {
  lead: PpcLeadRow
  attribution: Record<string, unknown>
  formSubmitted: boolean
  stage3Complete: boolean
  hasPpcCall: boolean
  connectedCallIds: Set<string>
  milestone60s: Set<string>
  milestone2m: Set<string>
  milestone5m: Set<string>
  appointmentIds: Set<string>
  revenue: number
  latestSignalAt: string | null
  latestSignal: string
}

const QUALIFIED_STAGES = new Set(['qualified', 'appointment_set', 'offer_made', 'under_contract', 'closed_won', 'contract_signed', 'closed'])
const CONTRACT_STAGES = new Set(['under_contract', 'closed_won', 'contract_signed', 'closed'])
const APPOINTMENT_STAGES = new Set(['appointment_set', 'offer_made', 'under_contract', 'closed_won', 'contract_signed', 'closed'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function money(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

function normalizeStage(stage: string | null | undefined): string {
  const value = text(stage).toLowerCase()
  if (!value || value === 'not_contacted') return 'new'
  if (value === 'appt_set' || value === 'appointment') return 'appointment_set'
  if (value === 'contract' || value === 'contract_signed' || value === 'in_closing') return 'under_contract'
  if (value === 'closed') return 'closed_won'
  return value
}

function metadata(activity: PpcActivityRow): Record<string, unknown> {
  return record(activity.metadata)
}

function activityId(activity: PpcActivityRow): string {
  const meta = metadata(activity)
  return text(meta.dialCallSid) || text(meta.callSid) || text(meta.dedupeKey) || activity.id
}

function milestoneKey(event: string, raw: string): string {
  const parts = raw.split(':').filter(Boolean)
  if (parts.length >= 3 && parts[0] === 'call') return `${event}:${parts[1]}`
  return `${event}:${raw}`
}

function outboxId(row: PpcOutboxRow): string {
  return text(row.dedupe_key) || row.id
}

function activityEvent(activity: PpcActivityRow): string {
  const meta = metadata(activity)
  return text(meta.event) || text(meta.event_name)
}

function digits(value: unknown): string {
  return text(value).replace(/\D/g, '')
}

function isPpcNumber(value: unknown): boolean {
  const valueDigits = digits(value)
  return valueDigits === PPC_TRACKING_PHONE_DIGITS || valueDigits === `1${PPC_TRACKING_PHONE_DIGITS}`
}

function isPpcActivity(activity: PpcActivityRow): boolean {
  const meta = metadata(activity)
  return (
    text(meta.traffic_source) === 'google_ads' ||
    text(meta.campaign) === 'Search 2026' ||
    isPpcNumber(meta.tracking_number) ||
    isPpcNumber(meta.calledNumber) ||
    isPpcNumber(meta.to)
  )
}

function isConnectedCall(activity: PpcActivityRow): boolean {
  const meta = metadata(activity)
  const type = text(activity.activity_type || activity.type).toLowerCase()
  const outcome = text(meta.outcome).toLowerCase()
  const status = text(meta.status || meta.dialStatus).toLowerCase()
  return type === 'call' && (outcome === 'connected' || status === 'completed' || status === 'answered')
}

function isFormSubmit(activity: PpcActivityRow): boolean {
  const meta = metadata(activity)
  return (
    text(meta.source) === 'ppc_form_submit' ||
    text(meta.form_status) === 'submitted' ||
    text(activity.description).toLowerCase() === 'ppc form submitted.'
  )
}

function isStage3Complete(activity: PpcActivityRow): boolean {
  const meta = metadata(activity)
  return (
    text(meta.source) === 'ppc_form_autosave' ||
    text(meta.form_status) === 'stage_3_complete_no_submit'
  )
}

function latestAt(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

function compactDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function getNested(input: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = input
  for (const part of path) {
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}

function extractAttributionFromManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  const acquisitionAttribution = record(getNested(manifest, ['acquisition', 'attribution']))
  const acquisition = record(manifest.acquisition)
  return cleanAttribution({
    ...acquisitionAttribution,
    source: acquisition.source,
    channel: acquisition.channel,
  })
}

function extractAttributionFromOutbox(row: PpcOutboxRow): Record<string, unknown> {
  return cleanAttribution({
    ...record(row.attribution),
    ...record(row.payload),
    click_id: row.click_id,
    click_id_type: row.click_id_type,
  })
}

function cleanAttribution(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const clean = typeof value === 'string' ? value.trim() : value
    if (clean !== undefined && clean !== null && clean !== '') output[key] = clean
  }
  return output
}

function mergeAttribution(current: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  return cleanAttribution({
    ...incoming,
    ...current,
    gclid: current.gclid || incoming.gclid,
    gbraid: current.gbraid || incoming.gbraid,
    wbraid: current.wbraid || incoming.wbraid,
    click_id: current.click_id || incoming.click_id,
    click_id_type: current.click_id_type || incoming.click_id_type,
  })
}

function hasClickId(attribution: Record<string, unknown>): boolean {
  return Boolean(text(attribution.gclid) || text(attribution.gbraid) || text(attribution.wbraid) || text(attribution.click_id))
}

function campaignName(attribution: Record<string, unknown>): string {
  return text(attribution.utm_campaign) || text(attribution.campaign) || 'Search 2026'
}

function sourceName(attribution: Record<string, unknown>): string {
  return text(attribution.utm_source) || (text(attribution.traffic_source) === 'google_ads' ? 'google' : 'google')
}

function mediumName(attribution: Record<string, unknown>): string {
  return text(attribution.utm_medium) || 'cpc'
}

function keywordName(attribution: Record<string, unknown>): string {
  return text(attribution.utm_term) || 'Unmapped keyword'
}

function contentName(attribution: Record<string, unknown>): string {
  return text(attribution.utm_content) || 'Unmapped ad'
}

function campaignId(attribution: Record<string, unknown>): string {
  return text(attribution.gad_campaignid) || text(attribution.campaign_id) || 'unmapped'
}

function adGroupId(attribution: Record<string, unknown>): string {
  return text(attribution.gad_adgroupid) || text(attribution.adgroup_id) || 'unmapped'
}

function displayPhone(phone: string | null): string {
  const phoneDigits = digits(phone)
  const ten = phoneDigits.length === 11 && phoneDigits.startsWith('1') ? phoneDigits.slice(1) : phoneDigits
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  return phone || '--'
}

function displayName(lead: PpcLeadRow): string {
  const name = text(lead.full_name)
  if (name && !/^(unknown|caller|new call)/i.test(name)) return name
  return displayPhone(lead.phone)
}

function makeLeadState(lead: PpcLeadRow): LeadState {
  return {
    lead,
    attribution: {},
    formSubmitted: false,
    stage3Complete: false,
    hasPpcCall: false,
    connectedCallIds: new Set(),
    milestone60s: new Set(),
    milestone2m: new Set(),
    milestone5m: new Set(),
    appointmentIds: new Set(),
    revenue: 0,
    latestSignalAt: lead.updated_at || lead.created_at,
    latestSignal: 'Lead created',
  }
}

function ensureBucket(buckets: Map<string, PpcReport['daily'][number]>, date: string | null) {
  const key = date || new Date().toISOString().slice(0, 10)
  if (!buckets.has(key)) {
    buckets.set(key, { date: key, leads: 0, formSubmits: 0, ppcCalls: 0, appointments: 0 })
  }
  return buckets.get(key)!
}

export function buildPpcReport(input: PpcReportInput): PpcReport {
  const leadStates = new Map<string, LeadState>()
  const buckets = new Map<string, PpcReport['daily'][number]>()

  for (const lead of input.leads) {
    leadStates.set(lead.id, makeLeadState(lead))
    ensureBucket(buckets, compactDate(lead.created_at)).leads += 1
  }

  for (const row of input.manifests) {
    if (!row.lead_id || !row.manifest) continue
    const state = leadStates.get(row.lead_id)
    if (!state) continue
    state.attribution = mergeAttribution(state.attribution, extractAttributionFromManifest(row.manifest))
  }

  const exportHealth = {
    total: input.outbox.length,
    primary: 0,
    secondary: 0,
    pending: 0,
    sent: 0,
    failed: 0,
    deadLetter: 0,
    skipped: 0,
  }

  for (const row of input.outbox) {
    const role = text(row.optimization_role).toLowerCase()
    if (role === 'primary') exportHealth.primary += 1
    if (role === 'secondary') exportHealth.secondary += 1

    const status = text(row.status).toLowerCase()
    if (status === 'pending' || status === 'processing') exportHealth.pending += 1
    if (status === 'sent') exportHealth.sent += 1
    if (status === 'failed') exportHealth.failed += 1
    if (status === 'dead_letter') exportHealth.deadLetter += 1
    if (status === 'skipped') exportHealth.skipped += 1

    if (!row.lead_id) continue
    const state = leadStates.get(row.lead_id)
    if (!state) continue

    state.attribution = mergeAttribution(state.attribution, extractAttributionFromOutbox(row))
    const event = text(row.event_name)
    if (event === 'lead_submitted') {
      state.formSubmitted = true
      ensureBucket(buckets, compactDate(row.event_time || row.created_at)).formSubmits += 1
    }
    if (event === 'lead_stage3_completed') state.stage3Complete = true
    if (event === 'call_connected_60s') state.milestone60s.add(milestoneKey(event, outboxId(row)))
    if (event === 'call_connected_2m') state.milestone2m.add(milestoneKey(event, outboxId(row)))
    if (event === 'call_connected_5m') state.milestone5m.add(milestoneKey(event, outboxId(row)))
    if (event.startsWith('call_connected_')) state.hasPpcCall = true
  }

  for (const activity of input.activities) {
    if (!activity.lead_id) continue
    const state = leadStates.get(activity.lead_id)
    if (!state) continue

    if (isFormSubmit(activity)) {
      state.formSubmitted = true
      ensureBucket(buckets, compactDate(activity.created_at)).formSubmits += 1
    }
    if (isStage3Complete(activity)) state.stage3Complete = true

    const event = activityEvent(activity)
    const id = activityId(activity)
    if (event === 'call_connected_60s') state.milestone60s.add(milestoneKey(event, id))
    if (event === 'call_connected_2m') state.milestone2m.add(milestoneKey(event, id))
    if (event === 'call_connected_5m') state.milestone5m.add(milestoneKey(event, id))

    if (isPpcActivity(activity)) {
      if (isConnectedCall(activity)) {
        state.connectedCallIds.add(id)
        ensureBucket(buckets, compactDate(activity.created_at)).ppcCalls += 1
      }
      if (isConnectedCall(activity) || event.startsWith('call_connected_')) {
        state.hasPpcCall = true
      }
    }

    const createdAt = activity.created_at
    if (createdAt && latestAt(createdAt, state.latestSignalAt) === createdAt) {
      state.latestSignalAt = createdAt
      state.latestSignal = text(activity.description) || text(activity.activity_type) || 'Activity'
    }
  }

  for (const appointment of input.appointments) {
    if (!appointment.lead_id) continue
    const state = leadStates.get(appointment.lead_id)
    if (!state) continue
    const status = text(appointment.status).toLowerCase()
    if (status !== 'cancelled' && status !== 'no_show') {
      state.appointmentIds.add(appointment.id)
      ensureBucket(buckets, compactDate(appointment.created_at || appointment.scheduled_at)).appointments += 1
    }
  }

  for (const row of input.revenue) {
    if (!row.deal_id) continue
    const state = leadStates.get(row.deal_id)
    if (!state) continue
    state.revenue += money(row.amount)
  }

  const states = Array.from(leadStates.values())
  const totalLeads = states.length
  const formSubmits = states.filter((state) => state.formSubmitted).length
  const stage3NoSubmit = states.filter((state) => state.stage3Complete && !state.formSubmitted).length
  const callLeads = states.filter((state) => state.hasPpcCall).length
  const connectedCalls = states.reduce((sum, state) => sum + state.connectedCallIds.size, 0)
  const call60s = states.reduce((sum, state) => sum + state.milestone60s.size, 0)
  const call2m = states.reduce((sum, state) => sum + state.milestone2m.size, 0)
  const call5m = states.reduce((sum, state) => sum + state.milestone5m.size, 0)
  const qualified = states.filter((state) => QUALIFIED_STAGES.has(normalizeStage(state.lead.station))).length
  const appointments = states.filter((state) => state.appointmentIds.size > 0 || APPOINTMENT_STAGES.has(normalizeStage(state.lead.station))).length
  const contracts = states.filter((state) => CONTRACT_STAGES.has(normalizeStage(state.lead.station))).length
  const revenue = states.reduce((sum, state) => sum + state.revenue, 0)
  const clickIds = states.filter((state) => hasClickId(state.attribution)).length
  const attributionCoverage = states.filter((state) => campaignName(state.attribution) !== 'Search 2026' || hasClickId(state.attribution)).length
  const sourceMediumCoverage = states.filter((state) => sourceName(state.attribution) && mediumName(state.attribution)).length

  const funnelCounts = [
    { key: 'leads', label: 'PPC CRM Leads', count: totalLeads },
    { key: 'stage3', label: 'Stage 3 Ready', count: states.filter((state) => state.stage3Complete).length },
    { key: 'submits', label: 'Final Form Submit', count: formSubmits },
    { key: 'qualified', label: 'Qualified', count: qualified },
    { key: 'appointments', label: 'Appointment Set', count: appointments },
    { key: 'contracts', label: 'Contract / Closing', count: contracts },
  ]

  const funnel = funnelCounts.map((step, index) => ({
    ...step,
    rateFromPrevious: index === 0 ? null : pct(step.count, funnelCounts[index - 1]?.count ?? 0),
    rateFromLead: index === 0 ? null : pct(step.count, totalLeads),
  }))

  const callQuality = [
    { key: 'connected', label: 'Connected PPC Calls', count: connectedCalls, shareOfConnected: null },
    { key: '60s', label: '60+ Seconds', count: call60s, shareOfConnected: pct(call60s, connectedCalls) },
    { key: '2m', label: '2+ Minutes', count: call2m, shareOfConnected: pct(call2m, connectedCalls) },
    { key: '5m', label: '5+ Minutes', count: call5m, shareOfConnected: pct(call5m, connectedCalls) },
  ]

  const attributionMap = new Map<string, PpcReport['attributionRows'][number]>()
  for (const state of states) {
    const attribution = state.attribution
    const row = {
      source: sourceName(attribution),
      medium: mediumName(attribution),
      campaign: campaignName(attribution),
      campaignId: campaignId(attribution),
      adGroupId: adGroupId(attribution),
      keyword: keywordName(attribution),
      content: contentName(attribution),
    }
    const key = [
      row.source,
      row.medium,
      row.campaign,
      row.campaignId,
      row.adGroupId,
      row.keyword,
      row.content,
    ].join('|')
    if (!attributionMap.has(key)) {
      attributionMap.set(key, {
        key,
        ...row,
        leads: 0,
        formSubmits: 0,
        stage3NoSubmit: 0,
        callLeads: 0,
        appointments: 0,
        contracts: 0,
        revenue: 0,
        clickIds: 0,
      })
    }
    const group = attributionMap.get(key)!
    group.leads += 1
    if (state.formSubmitted) group.formSubmits += 1
    if (state.stage3Complete && !state.formSubmitted) group.stage3NoSubmit += 1
    if (state.hasPpcCall) group.callLeads += 1
    if (state.appointmentIds.size > 0 || APPOINTMENT_STAGES.has(normalizeStage(state.lead.station))) group.appointments += 1
    if (CONTRACT_STAGES.has(normalizeStage(state.lead.station))) group.contracts += 1
    if (hasClickId(attribution)) group.clickIds += 1
    group.revenue += state.revenue
  }

  const recentLeads = states
    .map((state) => {
      const attribution = state.attribution
      const highestCallQuality = state.milestone5m.size > 0
        ? '5m+'
        : state.milestone2m.size > 0
          ? '2m+'
          : state.milestone60s.size > 0
            ? '60s+'
            : state.connectedCallIds.size > 0
              ? 'Connected'
              : '--'
      const formStatus = state.formSubmitted
        ? 'submitted'
        : state.stage3Complete
          ? 'stage_3_no_submit'
          : state.hasPpcCall
            ? 'call_only'
            : 'lead_only'
      const clickId = text(attribution.gclid) || text(attribution.gbraid) || text(attribution.wbraid) || text(attribution.click_id) || '--'
      return {
        id: state.lead.id,
        name: displayName(state.lead),
        phone: displayPhone(state.lead.phone),
        address: text(state.lead.property_address) || text(state.lead.city) || '--',
        stage: normalizeStage(state.lead.station).replace(/_/g, ' '),
        createdAt: state.lead.created_at,
        lastSignalAt: state.latestSignalAt,
        lastSignal: state.latestSignal,
        formStatus,
        campaign: campaignName(attribution),
        keyword: keywordName(attribution),
        clickId,
        callQuality: highestCallQuality,
        revenue: state.revenue,
      } satisfies PpcReport['recentLeads'][number]
    })
    .sort((a, b) => new Date(b.lastSignalAt || b.createdAt || 0).getTime() - new Date(a.lastSignalAt || a.createdAt || 0).getTime())
    .slice(0, 25)

  return {
    generatedAt: new Date().toISOString(),
    period: {
      days: input.days,
      since: input.since,
      until: input.until,
    },
    summary: {
      totalLeads,
      formSubmits,
      stage3NoSubmit,
      callLeads,
      connectedCalls,
      call60s,
      call2m,
      call5m,
      qualified,
      appointments,
      contracts,
      revenue,
      clickIdCoverageRate: pct(clickIds, totalLeads) ?? 0,
      submitRate: pct(formSubmits, totalLeads) ?? 0,
      appointmentRate: pct(appointments, totalLeads) ?? 0,
      contractRate: pct(contracts, totalLeads) ?? 0,
    },
    funnel,
    callQuality,
    attributionRows: Array.from(attributionMap.values())
      .sort((a, b) => b.revenue - a.revenue || b.formSubmits - a.formSubmits || b.leads - a.leads)
      .slice(0, 25),
    exportHealth,
    dataQuality: {
      clickIdCoverage: pct(clickIds, totalLeads) ?? 0,
      attributionCoverage: pct(attributionCoverage, totalLeads) ?? 0,
      sourceMediumCoverage: pct(sourceMediumCoverage, totalLeads) ?? 0,
      pendingExports: exportHealth.pending,
      failedExports: exportHealth.failed + exportHealth.deadLetter,
    },
    daily: Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date)),
    recentLeads,
  }
}
