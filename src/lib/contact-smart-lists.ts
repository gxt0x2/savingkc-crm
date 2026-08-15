import { isNotLeadOutcome } from '@/lib/lead-outcomes'
import type { DealStage } from '@/types/pipeline'

export type ContactSmartListNavigationId =
  | 'hot'
  | 'contacted'
  | 'qualified'
  | 'appointment_set'
  | 'offer_made'
  | 'in_closing'
  | 'all'

export type ContactSmartList =
  | ContactSmartListNavigationId
  | 'needs_reply'
  | 'overdue'
  | 'unassigned'
  | 'not_leads'

export interface SmartListContact {
  station: DealStage
  classification: 'lead' | 'opportunity' | 'dead' | null
  score: number
  isFavorite: boolean
  attentionState: 'needs_reply' | 'waiting_on_contact' | 'resolved'
  owner: string | null
  primaryNextAction: { overdue: boolean } | null
}

export const CONTACT_SMART_LISTS: ReadonlyArray<{ id: ContactSmartListNavigationId; label: string }> = [
  { id: 'contacted', label: 'Leads' },
  { id: 'qualified', label: 'Opportunities' },
  { id: 'appointment_set', label: 'Appointment Set' },
  { id: 'offer_made', label: 'Offer Made' },
  { id: 'in_closing', label: 'In Closing' },
  { id: 'all', label: 'All' },
]

export const CONTACT_SMART_LIST_ORDER_STORAGE_KEY = 'savingkc-contact-smart-list-order-v1'

export const DEFAULT_CONTACT_SMART_LIST_ORDER: ReadonlyArray<ContactSmartListNavigationId> = CONTACT_SMART_LISTS.map(({ id }) => id)

export function normalizeContactSmartListOrder(value: unknown): ContactSmartListNavigationId[] {
  if (!Array.isArray(value)) return [...DEFAULT_CONTACT_SMART_LIST_ORDER]

  const allowed = new Set<ContactSmartListNavigationId>(DEFAULT_CONTACT_SMART_LIST_ORDER)
  const seen = new Set<ContactSmartListNavigationId>()
  const requested = value.filter((id): id is ContactSmartListNavigationId => {
    if (typeof id !== 'string' || !allowed.has(id as ContactSmartListNavigationId)) return false
    const smartListId = id as ContactSmartListNavigationId
    if (seen.has(smartListId)) return false
    seen.add(smartListId)
    return true
  })

  return [...requested, ...DEFAULT_CONTACT_SMART_LIST_ORDER.filter((id) => !seen.has(id))]
}

export const CONTACT_SMART_LIST_COPY: Record<ContactSmartList, { label: string; description: string }> = {
  hot: {
    label: 'Hot',
    description: 'High-priority active records scored 75+ or manually starred.',
  },
  contacted: {
    label: 'Leads',
    description: 'Seller records an agent explicitly confirmed as leads.',
  },
  qualified: {
    label: 'Opportunities',
    description: 'Sellers who meet the opportunity standard and are ready for appointment or offer progression.',
  },
  appointment_set: {
    label: 'Appointment Set',
    description: 'Sellers with an acquisition appointment scheduled.',
  },
  offer_made: {
    label: 'Offer Made',
    description: 'Sellers reviewing an active offer and awaiting a decision.',
  },
  in_closing: {
    label: 'In Closing',
    description: 'Signed contracts moving through closing and transaction coordination.',
  },
  all: {
    label: 'All',
    description: 'Every explicitly classified acquisition record in the active sales pipeline.',
  },
  needs_reply: {
    label: 'Needs Reply',
    description: 'Active conversations waiting on an agent response.',
  },
  overdue: {
    label: 'Overdue Actions',
    description: 'Active records with a next action that is past due.',
  },
  unassigned: {
    label: 'Unassigned',
    description: 'Active records that still need an accountable owner.',
  },
  not_leads: {
    label: 'Not Leads',
    description: 'Records removed from the active pipeline with a required disposition reason.',
  },
}

export function isActiveAcquisitionContact(
  contact: Pick<SmartListContact, 'station' | 'classification'>,
): boolean {
  if (isNotLeadOutcome(contact.classification, contact.station)) return false
  if (contact.station === 'closed_won') return false
  if (contact.classification === 'lead' || contact.classification === 'opportunity') return true
  return ['qualified', 'appointment_set', 'offer_made', 'under_contract'].includes(contact.station)
}

export function contactPipelineStatusLabel(
  contact: Pick<SmartListContact, 'station' | 'classification'>,
): string {
  if (isNotLeadOutcome(contact.classification, contact.station)) return 'Not a lead'
  if (contact.station === 'appointment_set') return 'Appointment set'
  if (contact.station === 'offer_made') return 'Offer made'
  if (contact.station === 'under_contract') return 'In closing'
  if (contact.station === 'closed_won') return 'Closed won'
  if (contact.station === 'qualified' || contact.classification === 'opportunity') return 'Opportunity'
  if (contact.classification === 'lead') return 'Lead'
  return 'Not in pipeline'
}

export function contactMatchesSmartList(contact: SmartListContact, smartList: ContactSmartList): boolean {
  const active = isActiveAcquisitionContact(contact)
  if (smartList === 'not_leads') return isNotLeadOutcome(contact.classification, contact.station)
  if (!active) return false

  switch (smartList) {
    case 'hot':
      return contact.station !== 'under_contract' && (contact.score >= 75 || contact.isFavorite)
    case 'contacted':
      // Keep older explicitly-classified leads discoverable even when a legacy
      // write left their station at new. Later pipeline stages take precedence.
      return contact.classification === 'lead' && (contact.station === 'new' || contact.station === 'contacted')
    case 'qualified':
      return contact.station === 'qualified' || (
        contact.classification === 'opportunity' &&
        (contact.station === 'new' || contact.station === 'contacted')
      )
    case 'appointment_set':
      return contact.station === 'appointment_set'
    case 'offer_made':
      return contact.station === 'offer_made'
    case 'in_closing':
      return contact.station === 'under_contract'
    case 'needs_reply':
      return contact.attentionState === 'needs_reply'
    case 'overdue':
      return Boolean(contact.primaryNextAction?.overdue)
    case 'unassigned':
      return !contact.owner
    case 'all':
      return true
  }
}

export function contactSmartListCounts(contacts: SmartListContact[]): Record<ContactSmartList, number> {
  return Object.keys(CONTACT_SMART_LIST_COPY).reduce((counts, key) => {
    const smartList = key as ContactSmartList
    counts[smartList] = contacts.filter((contact) => contactMatchesSmartList(contact, smartList)).length
    return counts
  }, {} as Record<ContactSmartList, number>)
}
