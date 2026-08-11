export type ReportPeriod = '30d' | 'quarter' | 'ytd' | 'all'

export interface AcquisitionContact {
  id: string
  station: string
  score: number
  isFavorite: boolean
  source: string | null
  phone: string | null
  email: string | null
  createdAt: string | null
  firstOutboundAt: string | null
  lastContactAt: string | null
}

export interface AcquisitionThread {
  id: string
  attentionState: 'needs_reply' | 'waiting_on_contact' | 'resolved'
  owner: string | null
  lastActivityAt: string | null
  primaryNextAction: {
    overdue: boolean
  } | null
}

export interface AcquisitionSourceRow {
  source: string
  leads: number
  qualified: number
  appointments: number
  contracts: number
  averageScore: number
}

const STAGE_RANK: Record<string, number> = {
  new: 0,
  contacted: 1,
  qualified: 2,
  appointment_set: 3,
  offer_made: 4,
  under_contract: 5,
  closed_won: 6,
}

function validDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function periodStart(period: ReportPeriod, now: Date): Date | null {
  if (period === 'all') return null
  if (period === '30d') return new Date(now.getTime() - 30 * 86_400_000)
  if (period === 'ytd') return new Date(now.getFullYear(), 0, 1)
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
  return new Date(now.getFullYear(), quarterStartMonth, 1)
}

function isAtLeast(contact: AcquisitionContact, stage: string): boolean {
  const rank = STAGE_RANK[contact.station]
  const target = STAGE_RANK[stage]
  return typeof rank === 'number' && typeof target === 'number' && rank >= target
}

export function filterAcquisitionContacts(
  contacts: AcquisitionContact[],
  period: ReportPeriod,
  now = new Date(),
): AcquisitionContact[] {
  const start = periodStart(period, now)
  if (!start) return contacts
  return contacts.filter((contact) => {
    const createdAt = validDate(contact.createdAt)
    return createdAt !== null && createdAt >= start && createdAt <= now
  })
}

export function buildAcquisitionsReport(
  contacts: AcquisitionContact[],
  threads: AcquisitionThread[],
  now = new Date(),
) {
  const threadById = new Map(threads.map((thread) => [thread.id, thread]))
  const activeContacts = contacts.filter((contact) => !['closed_won', 'closed_lost', 'dead'].includes(contact.station))
  const total = contacts.length
  const qualified = contacts.filter((contact) => isAtLeast(contact, 'qualified')).length
  const appointments = contacts.filter((contact) => isAtLeast(contact, 'appointment_set')).length
  const offers = contacts.filter((contact) => isAtLeast(contact, 'offer_made')).length
  const contracts = contacts.filter((contact) => isAtLeast(contact, 'under_contract')).length
  const closed = contacts.filter((contact) => isAtLeast(contact, 'closed_won')).length
  const active = activeContacts.length

  const needsReply = activeContacts.filter((contact) => threadById.get(contact.id)?.attentionState === 'needs_reply').length
  const overdue = activeContacts.filter((contact) => threadById.get(contact.id)?.primaryNextAction?.overdue).length
  const unassigned = activeContacts.filter((contact) => !threadById.get(contact.id)?.owner).length
  const hot = activeContacts.filter((contact) => contact.score >= 75 || contact.isFavorite).length
  const stale = activeContacts.filter((contact) => {
    const activity = validDate(threadById.get(contact.id)?.lastActivityAt ?? contact.lastContactAt)
    return activity !== null && now.getTime() - activity.getTime() > 7 * 86_400_000
  }).length
  const noActivity = activeContacts.filter((contact) => !validDate(threadById.get(contact.id)?.lastActivityAt ?? contact.lastContactAt)).length
  const missingNextAction = activeContacts.filter((contact) => !threadById.get(contact.id)?.primaryNextAction).length

  const speedSamples = contacts.flatMap((contact) => {
    const created = validDate(contact.createdAt)
    const firstOutbound = validDate(contact.firstOutboundAt)
    if (!created || !firstOutbound || firstOutbound < created) return []
    return [(firstOutbound.getTime() - created.getTime()) / 60_000]
  })
  const averageSpeedToLeadMinutes = speedSamples.length
    ? Math.round(speedSamples.reduce((sum, minutes) => sum + minutes, 0) / speedSamples.length)
    : null

  const sourceGroups = new Map<string, AcquisitionContact[]>()
  for (const contact of contacts) {
    const source = contact.source?.trim() || 'unknown'
    sourceGroups.set(source, [...(sourceGroups.get(source) ?? []), contact])
  }
  const sources: AcquisitionSourceRow[] = [...sourceGroups.entries()]
    .map(([source, sourceContacts]) => ({
      source,
      leads: sourceContacts.length,
      qualified: sourceContacts.filter((contact) => isAtLeast(contact, 'qualified')).length,
      appointments: sourceContacts.filter((contact) => isAtLeast(contact, 'appointment_set')).length,
      contracts: sourceContacts.filter((contact) => isAtLeast(contact, 'under_contract')).length,
      averageScore: Math.round(sourceContacts.reduce((sum, contact) => sum + contact.score, 0) / sourceContacts.length),
    }))
    .sort((left, right) => right.leads - left.leads || right.contracts - left.contracts)

  const stages = [
    { key: 'leads', label: 'Leads', value: total },
    { key: 'qualified', label: 'Opportunities', value: qualified },
    { key: 'appointments', label: 'Appointments', value: appointments },
    { key: 'offers', label: 'Offers', value: offers },
    { key: 'contracts', label: 'Contracts', value: contracts },
    { key: 'closed', label: 'Closed', value: closed },
  ]

  const conversions = stages.slice(1).map((stage, index) => {
    const previous = stages[index]
    return {
      ...stage,
      rate: previous.value > 0 ? Math.round((stage.value / previous.value) * 100) : 0,
      previousLabel: previous.label,
    }
  })
  const bottleneck = conversions.reduce((lowest, conversion) => conversion.rate < lowest.rate ? conversion : lowest, conversions[0] ?? { key: 'none', label: 'No data', value: 0, rate: 0, previousLabel: 'No data' })

  return {
    total,
    active,
    qualified,
    appointments,
    offers,
    contracts,
    closed,
    attention: { needsReply, overdue, unassigned, hot, stale },
    dataQuality: {
      missingPhone: activeContacts.filter((contact) => !contact.phone).length,
      missingEmail: activeContacts.filter((contact) => !contact.email).length,
      noActivity,
      unassigned,
      missingNextAction,
    },
    averageSpeedToLeadMinutes,
    stages,
    conversions,
    bottleneck,
    sources,
  }
}
