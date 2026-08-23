import { describe, expect, it } from 'vitest'

import {
  CONTACT_SMART_LISTS,
  canonicalContactSmartList,
  contactMatchesSmartList,
  contactPipelineStatusLabel,
  contactSmartListCounts,
  normalizeContactSmartListOrder,
  type SmartListContact,
} from '@/lib/contact-smart-lists'

function contact(overrides: Partial<SmartListContact>): SmartListContact {
  return {
    station: 'new',
    classification: null,
    score: 10,
    isFavorite: false,
    attentionState: 'resolved',
    owner: 'Casey',
    primaryNextAction: null,
    pipelineIntentSource: null,
    ...overrides,
  }
}

describe('contact smart lists', () => {
  it('keeps the approved labels and order', () => {
    expect(CONTACT_SMART_LISTS.map(({ label }) => label)).toEqual([
      'New',
      'Leads',
      'Opportunities',
      'Appointment Set',
      'Offer Made',
      'In Closing',
      'All',
    ])
  })

  it('restores a saved tab order while discarding invalid smart lists', () => {
    expect(normalizeContactSmartListOrder(['all', 'hot', 'all', 'not_leads', 'new'])).toEqual([
      'all',
      'new',
      'contacted',
      'qualified',
      'appointment_set',
      'offer_made',
      'in_closing',
    ])
    expect(normalizeContactSmartListOrder(null)).toEqual(CONTACT_SMART_LISTS.map(({ id }) => id))
    expect(canonicalContactSmartList('hot')).toBe('qualified')
  })

  it('keeps Not Leads out of every active pipeline list', () => {
    const dead = contact({ station: 'dead', classification: 'dead', score: 100, isFavorite: true, owner: null, attentionState: 'needs_reply', primaryNextAction: { overdue: true } })

    for (const { id } of CONTACT_SMART_LISTS) {
      expect(contactMatchesSmartList(dead, id)).toBe(false)
    }
    expect(contactMatchesSmartList(dead, 'not_leads')).toBe(true)
  })

  it('maps stage and operating queues while keeping every dead classification inactive', () => {
    const contacts = [
      contact({ station: 'new', classification: null, pipelineIntentSource: 'website_form', score: 80, attentionState: 'needs_reply', owner: null }),
      contact({ station: 'contacted', classification: 'lead' }),
      contact({ station: 'qualified', classification: 'opportunity' }),
      contact({ station: 'appointment_set', classification: 'opportunity' }),
      contact({ station: 'offer_made', classification: 'opportunity', primaryNextAction: { overdue: true } }),
      contact({ station: 'under_contract', classification: 'opportunity' }),
      contact({ station: 'under_contract', classification: 'dead', isFavorite: true }),
      contact({ station: 'dead', classification: 'dead' }),
      contact({ station: 'closed_lost', classification: 'lead' }),
    ]

    expect(contactSmartListCounts(contacts)).toMatchObject({
      new: 1,
      hot: 1,
      contacted: 1,
      qualified: 1,
      appointment_set: 1,
      offer_made: 1,
      in_closing: 1,
      all: 6,
      needs_reply: 1,
      overdue: 1,
      unassigned: 1,
      prospects: 0,
      not_leads: 3,
    })
  })

  it('keeps unclassified prospecting contacts outside every pipeline list', () => {
    const newForm = contact({ station: 'new', classification: null, pipelineIntentSource: 'website_form' })
    const unqualifiedProspect = contact({ station: 'new', classification: null })
    const unclassifiedCaller = contact({ station: 'contacted', classification: null, attentionState: 'resolved' })
    const confirmedLead = contact({ station: 'contacted', classification: 'lead', attentionState: 'needs_reply' })
    const legacyConfirmedLead = contact({ station: 'new', classification: 'lead' })
    for (const { id } of CONTACT_SMART_LISTS) {
      expect(contactMatchesSmartList(unclassifiedCaller, id)).toBe(false)
    }

    expect(contactMatchesSmartList(newForm, 'new')).toBe(true)
    expect(contactMatchesSmartList(newForm, 'contacted')).toBe(false)
    expect(contactMatchesSmartList(unclassifiedCaller, 'contacted')).toBe(false)
    expect(contactMatchesSmartList(newForm, 'prospects')).toBe(false)
    expect(contactMatchesSmartList(unqualifiedProspect, 'prospects')).toBe(true)
    expect(contactMatchesSmartList(unclassifiedCaller, 'prospects')).toBe(true)
    expect(contactMatchesSmartList(confirmedLead, 'prospects')).toBe(false)
    expect(contactMatchesSmartList(confirmedLead, 'contacted')).toBe(true)
    expect(contactMatchesSmartList(legacyConfirmedLead, 'contacted')).toBe(true)
  })

  it('labels rows by their actual pipeline classification and stage', () => {
    expect(contactPipelineStatusLabel(contact({ station: 'new', classification: null, pipelineIntentSource: 'website_form' }))).toBe('New inquiry')
    expect(contactPipelineStatusLabel(contact({ station: 'new', classification: null }))).toBe('Not in pipeline')
    expect(contactPipelineStatusLabel(contact({ station: 'contacted', classification: 'lead' }))).toBe('Lead')
    expect(contactPipelineStatusLabel(contact({ station: 'qualified', classification: 'opportunity' }))).toBe('Opportunity')
    expect(contactPipelineStatusLabel(contact({ station: 'appointment_set', classification: 'opportunity' }))).toBe('Appointment set')
    expect(contactPipelineStatusLabel(contact({ station: 'under_contract', classification: 'opportunity' }))).toBe('In closing')
    expect(contactPipelineStatusLabel(contact({ station: 'dead', classification: 'dead' }))).toBe('Not a lead')
  })
})
