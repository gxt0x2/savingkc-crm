import { buildAcquisitionsReport, type AcquisitionContact, type AcquisitionThread } from './acquisitions-report'

export type OperatingReportPeriod = '30d' | 'quarter' | 'ytd' | 'all'

export interface OperatingLead {
  id: string
  full_name: string | null
  property_address: string | null
  city: string | null
  source: string | null
  station: string | null
  priority: string | null
  assigned_agent: string | null
  opportunity_score: number | null
  motivation_score?: number | null
  arv?: number | null
  offer_amount?: number | null
  is_favorite: boolean | null
  phone: string | null
  email: string | null
  created_at: string
}

export interface OperatingActivity {
  id: string
  lead_id: string | null
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface OperatingAppointment {
  id: string
  lead_id: string | null
  status: string | null
  source: string | null
  scheduled_at: string | null
  created_at: string
}

export interface OperatingDeal {
  id: string
  lead_id: string
  stage: string
  entered_at: string
  assignment_fee: number | null
  close_date: string | null
  accepted_offer_id?: string | null
  accepted_buyer_id: string | null
  closeout_status?: string | null
  debrief_due_at?: string | null
  debrief_completed_at?: string | null
  created_at: string
  updated_at: string
}

export interface OperatingOffer {
  id: string
  lead_id: string
  buyer_id: string
  offer_amount: number | null
  close_days: number | null
  status: string
  submitted_at: string | null
  decided_at: string | null
  created_at: string
}

export interface OperatingBuyer {
  id: string
  first_name?: string | null
  last_name?: string | null
  company_name?: string | null
  status: string | null
  tier: string | null
  deals_closed: number | null
  avg_close_days?: number | null
  last_deal_date: string | null
  created_at: string
}

export interface OperatingGoalSet {
  monthlyRevenue: number | null
  monthlyClosings: number | null
  dailyCalls: number | null
  weeklyQualified: number | null
  weeklyAppointments: number | null
}

export interface OperatingMoneyRow {
  id: string
  amount: number | null
  date: string
  source: string | null
  description?: string | null
  category?: string | null
  deal_id?: string | null
  property_address?: string | null
}

export interface OperatingReportInput {
  period: OperatingReportPeriod
  since: string | null
  until: string
  leads: OperatingLead[]
  referenceLeads?: OperatingLead[]
  threads: AcquisitionThread[]
  activities: OperatingActivity[]
  appointments: OperatingAppointment[]
  deals: OperatingDeal[]
  offers: OperatingOffer[]
  buyers: OperatingBuyer[]
  revenue: OperatingMoneyRow[]
  expenses: OperatingMoneyRow[]
  goals?: OperatingGoalSet
  availability: Record<string, boolean>
}

export interface OperatingTrendPoint {
  label: string
  value: number
}

const COMMUNICATION_TYPES = new Set([
  'call', 'outbound_call', 'inbound_call', 'sms', 'sms_sent', 'sms_received',
  'sms_inbound', 'sms_outbound', 'email', 'voicemail', 'missed_call',
])

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function isOutbound(activity: OperatingActivity): boolean {
  const type = activity.activity_type.toLowerCase()
  const direction = String(activity.metadata?.direction ?? activity.metadata?.callDirection ?? '').toLowerCase()
  const description = activity.description?.toLowerCase() ?? ''
  return type.includes('outbound') || type === 'sms_sent' || direction.includes('outbound') || description.includes('outbound')
}

function isInbound(activity: OperatingActivity): boolean {
  const type = activity.activity_type.toLowerCase()
  const direction = String(activity.metadata?.direction ?? activity.metadata?.callDirection ?? '').toLowerCase()
  const description = activity.description?.toLowerCase() ?? ''
  return type.includes('inbound') || type === 'sms_received' || direction.includes('inbound') || description.includes('inbound')
}

function isConnectedCall(activity: OperatingActivity): boolean {
  if (!activity.activity_type.toLowerCase().includes('call')) return false
  const metadata = activity.metadata ?? {}
  const values = [metadata.outcome, metadata.status, metadata.callStatus, metadata.dialStatus, metadata.disposition]
    .map((value) => String(value ?? '').toLowerCase())
  const description = activity.description?.toLowerCase() ?? ''
  return values.some((value) => /answered|connected|completed/.test(value)) || /connected live|answered|completed call|recording available/.test(description)
}

function isCommunication(activity: OperatingActivity): boolean {
  return COMMUNICATION_TYPES.has(activity.activity_type) ||
    activity.activity_type.includes('call') ||
    activity.activity_type.includes('sms')
}

function moneySum(rows: OperatingMoneyRow[]): number {
  return rows.reduce((sum, row) => sum + number(row.amount), 0)
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null
}

function latestFirst<T extends { date: string }>(left: T, right: T): number {
  return new Date(right.date).getTime() - new Date(left.date).getTime()
}

function reportStart(input: OperatingReportInput): number {
  const configured = timestamp(input.since)
  if (configured !== null) return configured
  const candidates = [
    ...input.leads.map((row) => timestamp(row.created_at)),
    ...input.activities.map((row) => timestamp(row.created_at)),
    ...input.appointments.map((row) => timestamp(row.scheduled_at ?? row.created_at)),
    ...input.deals.map((row) => timestamp(row.entered_at ?? row.created_at)),
    ...input.revenue.map((row) => timestamp(row.date)),
    ...input.expenses.map((row) => timestamp(row.date)),
  ].filter((value): value is number => value !== null)
  return candidates.length > 0 ? Math.min(...candidates) : new Date(input.until).getTime() - 30 * 86_400_000
}

function trendSeries<T>(
  rows: T[],
  input: OperatingReportInput,
  dateFor: (row: T) => string | null | undefined,
  valueFor: (row: T) => number = () => 1,
): OperatingTrendPoint[] {
  const start = reportStart(input)
  const end = new Date(input.until).getTime()
  const span = Math.max(end - start, 1)
  const bucketCount = 12
  const width = span / bucketCount
  const values = Array.from({ length: bucketCount }, () => 0)
  for (const row of rows) {
    const rowTime = timestamp(dateFor(row))
    if (rowTime === null || rowTime < start || rowTime > end) continue
    const bucket = Math.min(Math.floor((rowTime - start) / width), bucketCount - 1)
    values[bucket] += valueFor(row)
  }
  return values.map((value, index) => {
    const point = new Date(start + (index + 0.5) * width)
    return {
      label: point.toLocaleDateString('en-US', span > 120 * 86_400_000 ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' }),
      value: Math.round(value * 100) / 100,
    }
  })
}

function scoredAverage(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null)
  if (present.length === 0) return null
  return Math.round(present.reduce((sum, value) => sum + value, 0) / present.length)
}

export function buildOperatingReport(input: OperatingReportInput) {
  const referenceLeads = input.referenceLeads ?? input.leads
  const activitiesByLead = new Map<string, OperatingActivity[]>()
  for (const activity of input.activities) {
    if (!activity.lead_id) continue
    activitiesByLead.set(activity.lead_id, [...(activitiesByLead.get(activity.lead_id) ?? []), activity])
  }

  const contacts: AcquisitionContact[] = input.leads.map((lead) => {
    const leadActivities = activitiesByLead.get(lead.id) ?? []
    const communications = leadActivities.filter(isCommunication).sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
    const firstOutbound = communications.find(isOutbound)
    const lastCommunication = communications.at(-1)
    return {
      id: lead.id,
      station: lead.station ?? 'new',
      score: number(lead.opportunity_score),
      isFavorite: Boolean(lead.is_favorite || lead.priority === 'hot'),
      source: lead.source,
      phone: lead.phone,
      email: lead.email,
      createdAt: lead.created_at,
      firstOutboundAt: firstOutbound?.created_at ?? null,
      lastContactAt: lastCommunication?.created_at ?? null,
    }
  })
  const acquisitions = buildAcquisitionsReport(contacts, input.threads, new Date(input.until))
  const acquisitionAgentGroups = new Map<string, { leads: number; qualified: number; appointments: number; contracts: number }>()
  for (const lead of input.leads) {
    const rawOwner = lead.assigned_agent?.trim() || 'Unassigned'
    const ownerKey = rawOwner.toLocaleLowerCase()
    const owner = ({ casey: 'Casey', ernest: 'Ernest', gertha: 'Gertha', team: 'Team', unassigned: 'Unassigned' } as Record<string, string>)[ownerKey]
      ?? rawOwner.replace(/\b\w/g, (character) => character.toUpperCase())
    const row = acquisitionAgentGroups.get(owner) ?? { leads: 0, qualified: 0, appointments: 0, contracts: 0 }
    const stage = lead.station ?? 'new'
    const rank = ['new', 'contacted', 'qualified', 'appointment_set', 'offer_made', 'under_contract', 'closed_won'].indexOf(stage)
    row.leads += 1
    if (rank >= 2) row.qualified += 1
    if (rank >= 3) row.appointments += 1
    if (rank >= 5) row.contracts += 1
    acquisitionAgentGroups.set(owner, row)
  }
  const acquisitionAgents = [...acquisitionAgentGroups.entries()]
    .map(([agent, row]) => ({ agent, ...row, qualificationRate: percentage(row.qualified, row.leads), contractRate: percentage(row.contracts, row.leads) }))
    .sort((left, right) => right.contracts - left.contracts || right.qualified - left.qualified || right.leads - left.leads)

  const appointmentStatuses = new Map<string, number>()
  for (const appointment of input.appointments) {
    const status = appointment.status?.trim().toLowerCase() || 'unknown'
    appointmentStatuses.set(status, (appointmentStatuses.get(status) ?? 0) + 1)
  }
  const attendedAppointments = [...appointmentStatuses.entries()]
    .filter(([status]) => /completed|attended|showed|held/.test(status))
    .reduce((sum, [, count]) => sum + count, 0)
  const noShowAppointments = [...appointmentStatuses.entries()]
    .filter(([status]) => /no.?show/.test(status))
    .reduce((sum, [, count]) => sum + count, 0)

  const calls = input.activities.filter((activity) => activity.activity_type.toLowerCase().includes('call'))
  const sms = input.activities.filter((activity) => activity.activity_type.toLowerCase().includes('sms'))
  const connectedCalls = calls.filter(isConnectedCall).length
  const inboundSms = sms.filter(isInbound).length
  const outboundSms = sms.filter(isOutbound).length
  const agentMap = new Map<string, { calls: number; connected: number; sms: number; inbound: number; outbound: number }>()
  for (const activity of input.activities.filter(isCommunication)) {
    const metadataOwner = activity.metadata?.agent_name ?? activity.metadata?.assigned_to ?? activity.metadata?.owner
    const rawAgent = (activity.agent || (typeof metadataOwner === 'string' ? metadataOwner : '') || 'Unassigned').trim()
    const agentKey = rawAgent.toLocaleLowerCase()
    const agent = ({ casey: 'Casey', ernest: 'Ernest', gertha: 'Gertha', system: 'System', team: 'Team', unassigned: 'Unassigned' } as Record<string, string>)[agentKey]
      ?? rawAgent.replace(/\b\w/g, (character) => character.toUpperCase())
    const row = agentMap.get(agent) ?? { calls: 0, connected: 0, sms: 0, inbound: 0, outbound: 0 }
    if (activity.activity_type.toLowerCase().includes('call')) {
      row.calls += 1
      if (isConnectedCall(activity)) row.connected += 1
    }
    if (activity.activity_type.toLowerCase().includes('sms')) row.sms += 1
    if (isInbound(activity)) row.inbound += 1
    if (isOutbound(activity)) row.outbound += 1
    agentMap.set(agent, row)
  }
  const agents = [...agentMap.entries()]
    .map(([agent, row]) => ({ agent, ...row, contactRate: percentage(row.connected, row.calls) }))
    .sort((left, right) => right.calls + right.sms - (left.calls + left.sms))

  const offerLeadIds = new Set(input.offers.map((offer) => offer.lead_id))
  const activeDeals = input.deals.filter((deal) => !['closed', 'dead'].includes(deal.stage))
  const closedDeals = input.deals.filter((deal) => deal.stage === 'closed')
  const acceptedDeals = input.deals.filter((deal) => Boolean(deal.accepted_buyer_id || deal.accepted_offer_id))
  const noOfferDeals = activeDeals.filter((deal) => ['marketing', 'offers_in', 'negotiating'].includes(deal.stage) && !offerLeadIds.has(deal.lead_id))
  const dispositionDays = acceptedDeals.flatMap((deal) => {
    const acceptedOffer = input.offers.find((offer) => offer.id === deal.accepted_offer_id) ?? input.offers.find((offer) => offer.lead_id === deal.lead_id && offer.status === 'accepted')
    const start = timestamp(deal.entered_at)
    const end = timestamp(acceptedOffer?.decided_at ?? acceptedOffer?.submitted_at)
    return start !== null && end !== null && end >= start ? [(end - start) / 86_400_000] : []
  })
  const assignmentFees = closedDeals.map((deal) => number(deal.assignment_fee)).filter((fee) => fee > 0)
  const buyerClosingCounts = new Map<string, number>()
  for (const deal of closedDeals) {
    if (!deal.accepted_buyer_id) continue
    buyerClosingCounts.set(deal.accepted_buyer_id, (buyerClosingCounts.get(deal.accepted_buyer_id) ?? 0) + 1)
  }
  const repeatBuyerClosings = [...buyerClosingCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0)
  const debriefOutstanding = closedDeals.filter((deal) => deal.debrief_completed_at == null && deal.closeout_status !== 'complete').length
  const buyerById = new Map(input.buyers.map((buyer) => [buyer.id, buyer]))
  const recentClosings = closedDeals
    .map((deal) => {
      const lead = referenceLeads.find((item) => item.id === deal.lead_id)
      const buyer = deal.accepted_buyer_id ? buyerById.get(deal.accepted_buyer_id) : null
      const buyerName = buyer
        ? buyer.company_name?.trim() || [buyer.first_name, buyer.last_name].filter(Boolean).join(' ').trim() || 'Buyer record'
        : 'Not recorded'
      return {
        id: deal.id,
        leadId: deal.lead_id,
        property: lead?.property_address || lead?.full_name || 'Contact record',
        city: lead?.city ?? null,
        assignmentFee: number(deal.assignment_fee),
        buyer: buyerName,
        closeDate: deal.close_date,
        debriefComplete: Boolean(deal.debrief_completed_at || deal.closeout_status === 'complete'),
      }
    })
    .sort((left, right) => (timestamp(right.closeDate) ?? 0) - (timestamp(left.closeDate) ?? 0))
    .slice(0, 8)

  const offersByLead = new Map<string, OperatingOffer[]>()
  for (const offer of input.offers) {
    offersByLead.set(offer.lead_id, [...(offersByLead.get(offer.lead_id) ?? []), offer])
  }
  const reportUntil = new Date(input.until).getTime()
  const offerManagement = activeDeals
    .map((deal) => {
      const lead = referenceLeads.find((item) => item.id === deal.lead_id)
      const offers = offersByLead.get(deal.lead_id) ?? []
      const acceptedOffer = offers.find((offer) => offer.id === deal.accepted_offer_id) ?? offers.find((offer) => offer.status === 'accepted')
      const entered = timestamp(deal.entered_at)
      return {
        id: deal.id,
        leadId: deal.lead_id,
        property: lead?.property_address || lead?.full_name || 'Contact record',
        city: lead?.city ?? null,
        offers: offers.length,
        highestOffer: offers.length > 0 ? Math.max(...offers.map((offer) => number(offer.offer_amount))) : null,
        bestOffer: acceptedOffer ? number(acceptedOffer.offer_amount) : null,
        daysOnMarket: entered === null ? null : Math.max(0, Math.floor((reportUntil - entered) / 86_400_000)),
        stage: deal.stage,
      }
    })
    .sort((left, right) => right.offers - left.offers || (right.daysOnMarket ?? 0) - (left.daysOnMarket ?? 0))
    .slice(0, 8)

  const activeBuyers = input.buyers.filter((buyer) => buyer.status == null || buyer.status === 'active')
  const repeatBuyers = input.buyers.filter((buyer) => number(buyer.deals_closed) > 1)
  const vipBuyers = input.buyers.filter((buyer) => buyer.tier?.toLowerCase() === 'vip')
  const inactiveBuyers = input.buyers.filter((buyer) => buyer.status != null && buyer.status !== 'active')
  const offeredBuyerIds = new Set(input.offers.map((offer) => offer.buyer_id))
  const acceptedBuyerIds = new Set(input.offers.filter((offer) => offer.status === 'accepted').map((offer) => offer.buyer_id))
  const closedBuyerIds = new Set(closedDeals.map((deal) => deal.accepted_buyer_id).filter((id): id is string => Boolean(id)))
  const buyerFunnel = [
    { key: 'active', label: 'Active buyers', value: activeBuyers.length },
    { key: 'offered', label: 'Submitted offer', value: offeredBuyerIds.size },
    { key: 'accepted', label: 'Offer accepted', value: acceptedBuyerIds.size },
    { key: 'closed', label: 'Closed buyer', value: closedBuyerIds.size },
  ]
  const offersPerProperty = input.deals.length > 0 ? Math.round((input.offers.length / input.deals.length) * 10) / 10 : null
  const closeRate = percentage(closedDeals.length, input.deals.filter((deal) => deal.stage !== 'dead').length)
  const offerCoverage = percentage(activeDeals.length - noOfferDeals.length, activeDeals.length)
  const debriefCompletion = percentage(closedDeals.length - debriefOutstanding, closedDeals.length)
  const buyerActivity = percentage(offeredBuyerIds.size, activeBuyers.length)
  const healthScore = scoredAverage([closeRate, offerCoverage, debriefCompletion, buyerActivity])
  const speedScore = average(dispositionDays) == null ? null : Math.max(0, Math.min(100, Math.round(100 - average(dispositionDays)! * 8)))
  const buyerDemandScore = scoredAverage([
    offersPerProperty == null ? null : Math.min(100, Math.round(offersPerProperty * 20)),
    buyerActivity,
    speedScore,
  ])

  const revenueByLead = new Map<string, number>()
  for (const row of input.revenue) {
    if (!row.deal_id) continue
    revenueByLead.set(row.deal_id, (revenueByLead.get(row.deal_id) ?? 0) + number(row.amount))
  }
  const sourceGroups = new Map<string, { leads: number; qualified: number; appointments: number; contracts: number; revenue: number }>()
  for (const lead of input.leads) {
    const source = lead.source?.trim() || 'unknown'
    const stage = lead.station ?? 'new'
    const stageIndex = ['new', 'contacted', 'qualified', 'appointment_set', 'offer_made', 'under_contract', 'closed_won'].indexOf(stage)
    const row = sourceGroups.get(source) ?? { leads: 0, qualified: 0, appointments: 0, contracts: 0, revenue: 0 }
    row.leads += 1
    if (stageIndex >= 2) row.qualified += 1
    if (stageIndex >= 3) row.appointments += 1
    if (stageIndex >= 5) row.contracts += 1
    row.revenue += revenueByLead.get(lead.id) ?? 0
    sourceGroups.set(source, row)
  }
  const sources = [...sourceGroups.entries()]
    .map(([source, row]) => ({ source, ...row, qualificationRate: percentage(row.qualified, row.leads), contractRate: percentage(row.contracts, row.leads) }))
    .sort((left, right) => right.leads - left.leads || right.revenue - left.revenue)

  const grossRevenue = moneySum(input.revenue)
  const expenses = moneySum(input.expenses)
  const netRevenue = grossRevenue - expenses
  const expenseGroups = new Map<string, number>()
  for (const expense of input.expenses) {
    const category = expense.category?.trim() || 'uncategorized'
    expenseGroups.set(category, (expenseGroups.get(category) ?? 0) + number(expense.amount))
  }
  const expenseCategories = [...expenseGroups.entries()]
    .map(([category, amount]) => ({ category, amount, share: percentage(amount, expenses) }))
    .sort((left, right) => right.amount - left.amount)
  const recentTransactions = [
    ...input.revenue.map((row) => ({ id: row.id, type: 'Revenue' as const, date: row.date, amount: number(row.amount), label: row.property_address || row.description || 'Recorded revenue' })),
    ...input.expenses.map((row) => ({ id: row.id, type: 'Expense' as const, date: row.date, amount: number(row.amount), label: row.description || row.category || 'Recorded expense' })),
  ].sort(latestFirst).slice(0, 10)

  const openTasks = input.activities.filter((activity) => activity.activity_type === 'task' && String(activity.metadata?.status ?? 'pending') === 'pending')
  const overdueTasks = openTasks.filter((activity) => {
    const due = timestamp(typeof activity.metadata?.due_date === 'string' ? activity.metadata.due_date : null)
    return due !== null && due < new Date(input.until).getTime()
  })

  const bottlenecks = [
    { key: 'needs-reply', label: 'Needs reply', department: 'Acquisitions', count: acquisitions.attention.needsReply, href: '/conversations?reply=needs_reply', severity: acquisitions.attention.needsReply > 0 ? 'high' : 'clear' },
    { key: 'overdue-actions', label: 'Overdue next actions', department: 'Acquisitions', count: acquisitions.attention.overdue || overdueTasks.length, href: '/tasks?status=overdue', severity: acquisitions.attention.overdue || overdueTasks.length ? 'high' : 'clear' },
    { key: 'unassigned', label: 'Unassigned contacts', department: 'Acquisitions', count: acquisitions.attention.unassigned, href: '/contacts?list=unassigned', severity: acquisitions.attention.unassigned > 0 ? 'medium' : 'clear' },
    { key: 'no-offers', label: 'Marketed with no offers', department: 'Dispositions', count: noOfferDeals.length, href: '/dispo/pipeline', severity: noOfferDeals.length > 0 ? 'medium' : 'clear' },
    { key: 'debriefs', label: 'Closeout debriefs due', department: 'Dispositions', count: debriefOutstanding, href: '/dispo/pipeline?closeout=due', severity: debriefOutstanding > 0 ? 'high' : 'clear' },
  ] as const

  const insights = [
    acquisitions.attention.needsReply > 0
      ? `${acquisitions.attention.needsReply} seller conversation${acquisitions.attention.needsReply === 1 ? ' needs' : 's need'} a response.`
      : 'The seller inbox has no unresolved replies.',
    noOfferDeals.length > 0
      ? `${noOfferDeals.length} marketed propert${noOfferDeals.length === 1 ? 'y has' : 'ies have'} no recorded buyer offer.`
      : 'Every marketed disposition property has a recorded offer or has moved stages.',
    debriefOutstanding > 0
      ? `${debriefOutstanding} closed transaction debrief${debriefOutstanding === 1 ? ' is' : 's are'} still outstanding.`
      : 'All recorded closed transactions have completed their closeout loop.',
    sources[0]
      ? `${sources[0].source} is the largest recorded lead source with ${sources[0].leads} lead${sources[0].leads === 1 ? '' : 's'} in this period.`
      : 'No lead-source records were created in this period.',
  ]

  const activeLeadRows = input.leads.filter((lead) => !['closed_won', 'closed_lost', 'dead'].includes(lead.station ?? 'new'))
  const pipelineOfferValues = activeLeadRows.flatMap((lead) => lead.offer_amount == null ? [] : [number(lead.offer_amount)])
  const pipelineOfferValue = pipelineOfferValues.length > 0 ? pipelineOfferValues.reduce((sum, value) => sum + value, 0) : null
  const assignedLeads = input.leads.filter((lead) => Boolean(lead.assigned_agent?.trim())).length
  const stageAtLeast = (lead: OperatingLead, stage: string) => {
    const stages = ['new', 'contacted', 'qualified', 'appointment_set', 'offer_made', 'under_contract', 'closed_won']
    const rank = stages.indexOf(lead.station ?? 'new')
    const target = stages.indexOf(stage)
    return rank >= target && target >= 0
  }
  const revenueTrend = trendSeries(input.revenue, input, (row) => row.date, (row) => number(row.amount))
  const expenseTrend = trendSeries(input.expenses, input, (row) => row.date, (row) => number(row.amount))
  const trends = {
    revenue: revenueTrend,
    expenses: expenseTrend,
    net: revenueTrend.map((point, index) => ({ ...point, value: point.value - (expenseTrend[index]?.value ?? 0) })),
    profitMargin: revenueTrend.map((point, index) => {
      const expense = expenseTrend[index]?.value ?? 0
      return { ...point, value: point.value > 0 ? Math.round(((point.value - expense) / point.value) * 1000) / 10 : 0 }
    }),
    leads: trendSeries(input.leads, input, (row) => row.created_at),
    assigned: trendSeries(input.leads.filter((lead) => Boolean(lead.assigned_agent?.trim())), input, (row) => row.created_at),
    qualified: trendSeries(input.leads.filter((lead) => stageAtLeast(lead, 'qualified')), input, (row) => row.created_at),
    underContract: trendSeries(input.leads.filter((lead) => stageAtLeast(lead, 'under_contract')), input, (row) => row.created_at),
    closings: trendSeries(closedDeals, input, (row) => row.close_date),
    appointments: trendSeries(input.appointments, input, (row) => row.scheduled_at ?? row.created_at),
    calls: trendSeries(calls, input, (row) => row.created_at),
    connectedCalls: trendSeries(calls.filter(isConnectedCall), input, (row) => row.created_at),
    sms: trendSeries(sms, input, (row) => row.created_at),
    inboundSms: trendSeries(sms.filter(isInbound), input, (row) => row.created_at),
    outboundSms: trendSeries(sms.filter(isOutbound), input, (row) => row.created_at),
    offers: trendSeries(input.offers, input, (row) => row.submitted_at ?? row.created_at),
    activeDeals: trendSeries(activeDeals, input, (row) => row.entered_at ?? row.created_at),
    assignmentRevenue: trendSeries(closedDeals, input, (row) => row.close_date, (row) => number(row.assignment_fee)),
    buyers: trendSeries(input.buyers, input, (row) => row.created_at),
  }

  return {
    generatedAt: input.until,
    period: { key: input.period, since: input.since, until: input.until },
    availability: input.availability,
    core: {
      revenue: grossRevenue,
      expenses,
      netRevenue,
      activePipeline: acquisitions.active,
      pipelineOfferValue,
      leads: acquisitions.total,
      assigned: assignedLeads,
      qualified: acquisitions.qualified,
      underContract: acquisitions.contracts,
      closed: acquisitions.closed,
      needsReply: acquisitions.attention.needsReply,
    },
    acquisitions: {
      ...acquisitions,
      agents: acquisitionAgents,
      appointmentsRecorded: input.appointments.length,
      attendedAppointments,
      noShowAppointments,
      appointmentShowRate: percentage(attendedAppointments, attendedAppointments + noShowAppointments),
    },
    marketing: { sources },
    dispositions: {
      activeDeals: activeDeals.length,
      closedDeals: closedDeals.length,
      offers: input.offers.length,
      offersPerProperty,
      averageDaysToBuyer: average(dispositionDays) == null ? null : Math.round(average(dispositionDays)! * 10) / 10,
      assignmentRevenue: assignmentFees.reduce((sum, fee) => sum + fee, 0),
      averageAssignmentFee: average(assignmentFees) == null ? null : Math.round(average(assignmentFees)!),
      closeRate,
      healthScore,
      buyerDemandScore,
      offerCoverage,
      debriefCompletion,
      activeBuyers: activeBuyers.length,
      repeatBuyers: repeatBuyers.length,
      vipBuyers: vipBuyers.length,
      inactiveBuyers: inactiveBuyers.length,
      repeatBuyerClosings,
      debriefOutstanding,
      stages: Object.entries(input.deals.reduce<Record<string, number>>((acc, deal) => ({ ...acc, [deal.stage]: (acc[deal.stage] ?? 0) + 1 }), {})),
      recentClosings,
      offerManagement,
      buyerFunnel,
    },
    finance: {
      grossRevenue,
      expenses,
      netRevenue,
      profitMargin: percentage(netRevenue, grossRevenue),
      revenueTransactions: input.revenue.length,
      averageRevenuePerTransaction: input.revenue.length > 0 ? Math.round(grossRevenue / input.revenue.length) : null,
      expenseCategories,
      recentTransactions,
    },
    communications: {
      calls: calls.length,
      connectedCalls,
      callConnectionRate: percentage(connectedCalls, calls.length),
      sms: sms.length,
      inboundSms,
      outboundSms,
      smsResponseRate: percentage(inboundSms, outboundSms),
      voicemail: input.activities.filter((activity) => activity.activity_type === 'voicemail').length,
      agents,
    },
    goals: input.goals ?? {
      monthlyRevenue: null,
      monthlyClosings: null,
      dailyCalls: null,
      weeklyQualified: null,
      weeklyAppointments: null,
    },
    trends,
    bottlenecks,
    insights,
  }
}

export type OperatingReport = ReturnType<typeof buildOperatingReport>
