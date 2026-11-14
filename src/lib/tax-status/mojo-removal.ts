import type { PlannedTaxCheck } from './gate'

/**
 * Mojo has no contact-delete or remove-from-list write that this CRM can call.
 *
 * Public docs describe a one-way posting API (lead vendors push data in with a
 * Posting PIN). The connected Mojo MCP is read-only (calls, sessions, stats).
 * The repo's Mojo client only reads activity, contacts, recordings, and reports.
 * "Move To DNC" in the Mojo UI leaves the contact on its list, and this CRM's
 * DNC path records a disposition locally. It does not push a removal.
 *
 * Until a write endpoint exists, the 3:00am gate queues a worklist. A person
 * removes those rows in the Mojo UI before 9:00am America/Chicago, then the
 * CRM stamps the row confirmed. Producing the worklist is not that stamp.
 */
export const MOJO_CONTACT_WRITE_API = null

export const MOJO_REMOVAL_COLUMNS = ['contact_name', 'phone', 'mojo_list_name'] as const

export type MojoRemovalStatus = 'pending_browser' | 'confirmed'

export interface MojoRemovalWorkItem {
  id?: string
  contactName: string
  phone: string
  mojoListName: string
  parcelId: string | null
  county: string | null
  prospectId: string | null
  propertyId: string | null
  sourceListRowId: string | null
  status: MojoRemovalStatus
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`
  return value
}

export function removalWorkItems(plans: readonly PlannedTaxCheck[]): MojoRemovalWorkItem[] {
  const items: MojoRemovalWorkItem[] = []
  const seen = new Set<string>()
  for (const plan of plans) {
    if (!plan.queueRemoval || plan.result !== 'not_delinquent') continue
    for (const contact of plan.candidate.contacts) {
      const phone = contact.phone.trim()
      const name = contact.name.trim()
      const list = contact.mojoListName.trim()
      if (!phone || !name || !list) continue
      const key = `${phone}|${list.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        contactName: name,
        phone,
        mojoListName: list,
        parcelId: plan.candidate.parcelId,
        county: plan.county,
        prospectId: plan.candidate.prospectId,
        propertyId: plan.candidate.propertyId,
        sourceListRowId: plan.candidate.sourceListRowId,
        status: 'pending_browser',
      })
    }
  }
  return items
}

export function mojoRemovalCsv(items: readonly MojoRemovalWorkItem[]): string {
  const lines = [MOJO_REMOVAL_COLUMNS.join(',')]
  for (const item of items) {
    if (item.status !== 'pending_browser') continue
    lines.push([item.contactName, item.phone, item.mojoListName].map(csvCell).join(','))
  }
  return `${lines.join('\n')}\n`
}

export interface RemovalConfirmation {
  status: 'confirmed'
  confirmedAt: string
  confirmedBy: string
}

/** Stamp only after the browser removal is confirmed. This does not call Mojo. */
export function confirmMojoRemoval(actor: string, now: Date): RemovalConfirmation {
  const confirmedBy = actor.trim()
  if (!confirmedBy) throw new Error('removal_actor_required')
  return {
    status: 'confirmed',
    confirmedAt: now.toISOString(),
    confirmedBy,
  }
}
