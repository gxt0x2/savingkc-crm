import { describe, expect, it } from 'vitest'

import {
  CONTACT_SMART_LISTS,
  contactMatchesSmartList,
  contactSmartListCounts,
  normalizeContactSmartListOrder,
  type SmartListContact,
} from '@/lib/contact-smart-lists'

function contact(overrides: Partial<SmartListContact>): SmartListContact {
  return {
    station: 'new',
    classification: 'lead',
    score: 10,
    isFavorite: false,
    attentionState: 'resolved',
    owner: 'Casey',
    primaryNextAction: null,
    ...overrides,
  }
}

describe('contact smart lists', () => {
  it('keeps the approved labels and order', () => {
    expect(CONTACT_SMART_LISTS.map(({ label }) => label)).toEqual([
      'Hot',
      'New',
      'Leads',
      'Opportunities',
      'Appointment Set',
      'Offer Made',
      'In Closing',
      'All',
    ])
  })

  it('restores a saved tab order without losing new or invalid smart lists', () => {
    expect(normalizeContactSmartListOrder(['all', 'hot', 'all', 'not_leads', 'new'])).toEqual([
      'all',
      'hot',
      'new',
      'contacted',
      'qualified',
      'appointment_set',
      'offer_made',
      'in_closing',
    ])
    expect(normalizeContactSmartListOrder(null)).toEqual(CONTACT_SMART_LISTS.map(({ id }) => id))
  })

  it('keeps Not Leads out of every active pipeline list', () => {
    const dead = contact({ station: 'dead', classification: 'dead', score: 100, isFavorite: true, owner: null, attentionState: 'needs_reply', primaryNextAction: { overdue: true } })

    for (const { id } of CONTACT_SMART_LISTS) {
      expect(contactMatchesSmartList(dead, id)).toBe(false)
    }
    expect(contactMatchesSmartList(dead, 'not_leads')).toBe(true)
  })

  it('maps stage and operating queues without trusting stale classifications', () => {
    const contacts = [
      contact({ station: 'new', score: 80, attentionState: 'needs_reply', owner: null }),
      contact({ station: 'contacted' }),
      contact({ station: 'qualified' }),
      contact({ station: 'appointment_set' }),
      contact({ station: 'offer_made', primaryNextAction: { overdue: true } }),
      contact({ station: 'under_contract' }),
      contact({ station: 'under_contract', classification: 'dead', isFavorite: true }),
      contact({ station: 'dead', classification: 'dead' }),
      contact({ station: 'closed_lost', classification: 'lead' }),
    ]

    expect(contactSmartListCounts(contacts)).toMatchObject({
      hot: 1,
      new: 1,
      contacted: 1,
      qualified: 1,
      appointment_set: 1,
      offer_made: 1,
      in_closing: 2,
      all: 7,
      needs_reply: 1,
      overdue: 1,
      unassigned: 1,
      not_leads: 2,
    })
  })
})
