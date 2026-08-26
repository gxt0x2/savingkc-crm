import { MY_DAY_TIME_ZONE } from '@/lib/my-day-range'

export interface MyDayAttentionItem {
  id: string
  leadId: string
  leadName: string
  property: string
  happenedAt: string
  disposition: string
  kind: 'terminal_record_activity'
  missingFollowUpAt: boolean
  href: string
}

export interface MyDayMojoEvent {
  record_id: string
  lead_id: string | null
  contact_name: string | null
  property_address: string | null
  call_at: string
  disposition_raw: string
  outcome: string
  follow_up_at: string | null
}

export interface MyDayAttentionLead {
  id: string
  full_name: string | null
  property_address: string | null
  station: string | null
  classification: string | null
}

export interface MyDayTerminalEvent {
  lead_id: string
  to_stage: string | null
  occurred_at: string
}

const DATE_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: MY_DAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function isWithinRange(value: string, range: { from: string; to: string }): boolean {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return false
  const key = DATE_KEY.format(date)
  return key >= range.from && key <= range.to
}

export function buildMojoAttentionItems(input: {
  events: MyDayMojoEvent[]
  leads: MyDayAttentionLead[]
  terminalEvents: MyDayTerminalEvent[]
  range: { from: string; to: string }
}): MyDayAttentionItem[] {
  const leadsById = new Map(input.leads.map((lead) => [lead.id, lead]))
  const terminalStages = new Set(['dead', 'closed_lost'])
  const reviewableOutcomes = new Set(['callback_scheduled', 'meaningful_conversation', 'appointment_set'])

  return input.events.flatMap((event): MyDayAttentionItem[] => {
    if (!event.lead_id || !isWithinRange(event.call_at, input.range) || !reviewableOutcomes.has(event.outcome)) return []
    const lead = leadsById.get(event.lead_id)
    const terminal = terminalStages.has((lead?.station || '').toLowerCase())
      || (lead?.classification || '').toLowerCase() === 'dead'
    const eventTime = new Date(event.call_at).getTime()
    const wasTerminalAtEvent = input.terminalEvents.some((terminalEvent) => (
      terminalEvent.lead_id === event.lead_id
      && terminalStages.has((terminalEvent.to_stage || '').toLowerCase())
      && new Date(terminalEvent.occurred_at).getTime() <= eventTime
    ))
    if (!lead || !terminal || !wasTerminalAtEvent) return []
    return [{
      id: `mojo:${event.record_id}`,
      leadId: lead.id,
      leadName: lead.full_name?.trim() || event.contact_name?.trim() || 'Unknown seller',
      property: lead.property_address?.trim() || event.property_address?.trim() || 'No property linked',
      happenedAt: event.call_at,
      disposition: event.disposition_raw,
      kind: 'terminal_record_activity',
      missingFollowUpAt: event.outcome === 'callback_scheduled' && !event.follow_up_at,
      href: `/leads/${lead.id}`,
    }]
  }).sort((left, right) => new Date(right.happenedAt).getTime() - new Date(left.happenedAt).getTime())
}
