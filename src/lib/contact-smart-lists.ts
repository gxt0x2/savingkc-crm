import { isNotLeadOutcome } from '@/lib/lead-outcomes'
import type { DealStage } from '@/types/pipeline'

export type ContactSmartList =
  | 'hot'
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'appointment_set'
  | 'offer_made'
  | 'in_closing'
  | 'all'
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

export const CONTACT_SMART_LISTS: ReadonlyArray<{ id: ContactSmartList; label: string }> = [
  { id: 'hot', label: 'Hot' },
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Leads' },
  { id: 'qualified', label: 'Opportunities' },
  { id: 'appointment_set', label: 'Appointment Set' },
  { id: 'offer_made', label: 'Offer Made' },
  { id: 'in_closing', label: 'In Closing' },
  { id: 'all', label: 'All' },
]

export const CONTACT_SMART_LIST_COPY: Record<ContactSmartList, { label: string; description: string }> = {
  hot: {
    label: 'Hot',
    description: 'High-priority active records scored 75+ or manually starred.',
  },
  new: {
    label: 'New',
    description: 'New seller inquiries awaiting qualification and first contact.',
  },
  contacted: {
    label: 'Leads',
    description: 'Contacted sellers currently being worked and qualified.',
  },
  qualified: {
    label: 'Opportunities',
    description: 'Qualified sellers ready for appointment or offer progression.',
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
    description: 'Every active acquisition record, excluding contacts marked Not a lead.',
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

export function isActiveAcquisitionContact(contact: SmartListContact): boolean {
  return !isNotLeadOutcome(contact.classification, contact.station)
}

export function contactMatchesSmartList(contact: SmartListContact, smartList: ContactSmartList): boolean {
  const active = isActiveAcquisitionContact(contact)
  if (smartList === 'not_leads') return !active
  if (!active) return false

  switch (smartList) {
    case 'hot':
      return contact.station !== 'under_contract' && (contact.score >= 75 || contact.isFavorite)
    case 'new':
      return contact.station === 'new'
    case 'contacted':
      return contact.station === 'contacted'
    case 'qualified':
      return contact.station === 'qualified'
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
