import { describe, expect, it } from 'vitest'
import {
  LEAD_CALL_ALLOW,
  LEAD_CALL_DEAD,
  LEAD_DEAD_ALLOW,
  LEAD_DEAD_DISCONNECTED,
  LEAD_DEAD_PERSON,
  LEAD_DEAD_PHONE_DNC,
  MOJO_ALLOW,
  NEVER_DOWNGRADE,
  PHONE_CONNECTED_ALLOW,
  PHONE_CONNECTED_DISCONNECTED,
  PROSPECT_ALLOW,
  PROSPECT_DEAD,
  PROSPECT_PERSON_DNC,
  PROSPECT_PHONE_DNC,
  PROSPECT_WRONG,
  exportBlockReason,
  labelKey,
  phoneKey,
  suppressionClass,
} from './dialer-suppression-policy'
import {
  NEWLY_BLOCKED_CATEGORY_COUNTS,
  blockedCategoryCounts,
  buildNewlyBlockedFixtures,
} from './dialer-suppression-newly-blocked.fixture'

function legacyBlock(phone: string, world: Parameters<typeof exportBlockReason>[1]): string | null {
  const key = phoneKey(phone)
  const phones = (world?.phones ?? []).filter((row) => phoneKey(row.phone) === key)
  const disposition = (value: string | null | undefined) => labelKey(value)
  if (phones.some((row) => ['dnc', 'do_not_call'].includes(disposition(row.lastDisposition) ?? ''))) return 'prospect_dnc'
  if (phones.some((row) => disposition(row.lastDisposition) === 'wrong_number' || disposition(row.phoneConnected) === 'wrong_number')) {
    return 'wrong_number'
  }
  if (phones.some((row) => (
    ['disconnected', 'bad_number', 'not_in_service'].includes(disposition(row.lastDisposition) ?? '')
    || ['false', 'no', 'disconnected', 'bad_number'].includes(disposition(row.phoneConnected) ?? '')
  ))) return 'disconnected'
  const leads = (world?.leads ?? []).filter((lead) => phoneKey(lead.phone) === key)
  if (leads.some((lead) => (
    ['dnc_refused', 'dnc', 'do_not_call'].includes(String(lead.deadReason ?? '').trim().toLowerCase())
    || ['dnc', 'do_not_call'].includes(disposition(lead.callResult) ?? '')
  ))) return 'lead_dnc'
  return null
}

describe('dialer suppression labels', () => {
  it('normalizes mixed case, spaces, and hyphens before comparing', () => {
    expect(labelKey(' DNC Number ')).toBe('dnc_number')
    expect(labelKey('take-me-off')).toBe('take_me_off')
    expect(labelKey('Wrong Or Disconnected')).toBe('wrong_or_disconnected')
    expect(suppressionClass('lead_call_result', 'DNC Number')).toBe('lead_dnc')
  })

  it.each(PROSPECT_PHONE_DNC)('blocks prospect phone label %s', (label) => {
    const phone = '+18165550111'
    expect(exportBlockReason(phone, { phones: [{ phone, lastDisposition: label }] })).toBe('prospect_dnc')
  })

  it.each(PROSPECT_PERSON_DNC)('blocks person label %s on that number', (label) => {
    const phone = '+18165550112'
    expect(exportBlockReason(phone, { phones: [{ phone, lastDisposition: label }] })).toBe('prospect_dnc')
  })

  it.each(PROSPECT_DEAD)('blocks dead or disconnected disposition %s', (label) => {
    const phone = '+18165550113'
    expect(exportBlockReason(phone, { phones: [{ phone, lastDisposition: label }] })).toBe('disconnected')
  })

  it.each(PROSPECT_WRONG)('blocks wrong number label %s', (label) => {
    const phone = '+18165550114'
    expect(exportBlockReason(phone, { phones: [{ phone, lastDisposition: label }] })).toBe('wrong_number')
  })

  it.each(PHONE_CONNECTED_DISCONNECTED)('blocks phone_connected %s', (label) => {
    const phone = '+18165550115'
    expect(exportBlockReason(phone, { phones: [{ phone, phoneConnected: label }] })).toBe('disconnected')
  })

  it.each(LEAD_CALL_DEAD)('blocks lead call result %s as a dead number', (label) => {
    const phone = '+18165550116'
    expect(exportBlockReason(phone, { leads: [{ id: 'lead', phone, callResult: label }] })).toBe('dead_number')
  })

  it.each(LEAD_DEAD_PHONE_DNC)('blocks lead dead reason %s', (label) => {
    const phone = '+18165550117'
    expect(exportBlockReason(phone, { leads: [{ id: 'lead', phone, deadReason: label }] })).toBe('lead_dnc')
  })

  it.each(LEAD_DEAD_PERSON)('blocks lead dead reason %s', (label) => {
    const phone = '+18165550118'
    expect(exportBlockReason(phone, { leads: [{ id: 'lead', phone, deadReason: label }] })).toBe('lead_dnc')
  })

  it.each(LEAD_DEAD_DISCONNECTED)('blocks lead dead reason %s as disconnected', (label) => {
    const phone = '+18165550119'
    expect(exportBlockReason(phone, { leads: [{ id: 'lead', phone, deadReason: label }] })).toBe('disconnected')
  })

  it('blocks a Mojo dnc or disconnected outcome even when the prospect stamp is blank', () => {
    const phone = '+18165550130'
    expect(exportBlockReason(phone, {
      phones: [{ phone, lastDisposition: null }],
      mojoEvents: [{ phone, outcome: 'dnc' }],
    })).toBe('mojo_dnc')
    expect(exportBlockReason(phone, {
      phones: [{ phone, lastDisposition: null }],
      mojoEvents: [{ phone, outcome: 'disconnected' }],
    })).toBe('disconnected')
  })

  it('keeps a null disposition and dataskip_dnc exportable', () => {
    const phone = '+18165550120'
    expect(exportBlockReason(phone, { phones: [{ phone, lastDisposition: null, phoneConnected: null }] })).toBeNull()
    expect(exportBlockReason(phone, { phones: [{ phone, phoneConnected: 'dataskip_dnc' }] })).toBeNull()
    expect(suppressionClass('phone_connected', 'dataskip_dnc')).toBe('allow')
  })

  it('fails closed on an unclassified label', () => {
    const phone = '+18165550121'
    expect(exportBlockReason(phone, { phones: [{ phone, lastDisposition: 'litigator' }] })).toBe('unmapped_label')
    expect(suppressionClass('prospect_disposition', 'suppressed_bad_number')).toBe('unmapped')
    expect(suppressionClass('prospect_disposition', 'suppressed_lookup_inactive')).toBe('unmapped')
  })

  it('holds a last-4-only suppression match instead of exporting it', () => {
    expect(exportBlockReason('+18165550122', {
      phones: [{ phone: '0122', lastDisposition: 'dnc' }],
    })).toBe('hold_last4')
  })

  it('protects the never-downgrade set from a weaker Mojo stamp', () => {
    expect(NEVER_DOWNGRADE).toEqual(['dnc', 'do_not_call', 'dnc_number', 'dnc_contact', 'take_me_off', 'dead'])
    for (const label of NEVER_DOWNGRADE) expect(suppressionClass('never_downgrade', label)).toBe('protected')
    expect(suppressionClass('never_downgrade', 'fax')).toBeNull()
    expect(suppressionClass('never_downgrade', 'no_answer')).toBeNull()
  })

  it('allows every known non-blocking label', () => {
    for (const label of PROSPECT_ALLOW) expect(suppressionClass('prospect_disposition', label)).toBe('allow')
    for (const label of LEAD_CALL_ALLOW) expect(suppressionClass('lead_call_result', label)).toBe('allow')
    for (const label of LEAD_DEAD_ALLOW) expect(suppressionClass('lead_dead_reason', label)).toBe('allow')
    for (const label of MOJO_ALLOW) expect(suppressionClass('mojo_outcome', label)).toBe('allow')
    for (const label of PHONE_CONNECTED_ALLOW) expect(suppressionClass('phone_connected', label)).toBe('allow')
  })
})

describe('120 phones that pass today', () => {
  const fixtures = buildNewlyBlockedFixtures()

  it('uses the dry-run category counts', () => {
    expect(fixtures).toHaveLength(120)
    const built = fixtures.reduce<Record<string, number>>((counts, fixture) => {
      counts[fixture.category] = (counts[fixture.category] ?? 0) + 1
      return counts
    }, {})
    expect(built).toEqual(NEWLY_BLOCKED_CATEGORY_COUNTS)
    expect(Object.values(NEWLY_BLOCKED_CATEGORY_COUNTS).reduce((sum, count) => sum + count, 0)).toBe(120)
  })

  it('blocks every category and would have passed the two-label scrub', () => {
    for (const fixture of fixtures) {
      expect(legacyBlock(fixture.phone, fixture.world), fixture.category).toBeNull()
      expect(exportBlockReason(fixture.phone, fixture.world, fixture.prospectId), `${fixture.category} ${fixture.phone}`).toBe(fixture.expectedReason)
    }
    expect(blockedCategoryCounts(fixtures)).toEqual(NEWLY_BLOCKED_CATEGORY_COUNTS)
  })

  it('keeps the three do-not-call labels and the dead label out of an export', () => {
    const leaks = [
      { label: 'dnc_number', reason: 'prospect_dnc' },
      { label: 'dnc_contact', reason: 'prospect_dnc' },
      { label: 'take_me_off', reason: 'prospect_dnc' },
      { label: 'dead', reason: 'disconnected' },
    ]
    for (const leak of leaks) {
      const phone = '+18165550999'
      const world = { phones: [{ phone, lastDisposition: leak.label }] }
      expect(legacyBlock(phone, world)).toBeNull()
      expect(exportBlockReason(phone, world)).toBe(leak.reason)
    }
  })
})
