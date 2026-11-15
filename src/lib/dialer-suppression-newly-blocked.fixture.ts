import { exportBlockReason, type SuppressionWorld } from './dialer-suppression-policy'

export type NewlyBlockedCategory = keyof typeof NEWLY_BLOCKED_CATEGORY_COUNTS

/**
 * Representative phones that pass the two-label scrub and must block after
 * the widened rules. Counts are the dry-run breakdown (120 rows). Numbers are
 * fictional 555 exchanges, not live CRM phones.
 */
export const NEWLY_BLOCKED_CATEGORY_COUNTS = {
  person_fanout: 60,
  dead_or_fax: 31,
  disconnected: 12,
  household_fanout: 10,
  lead_dnc: 3,
  prospect_dnc: 3,
  mojo_dnc: 1,
} as const

export interface NewlyBlockedFixture {
  category: NewlyBlockedCategory
  expectedReason: string
  phone: string
  prospectId?: string
  world: SuppressionWorld
}

function fictional(slot: number): string {
  return `+1816555${String(slot).padStart(4, '0')}`
}

function row(
  category: NewlyBlockedCategory,
  expectedReason: string,
  phone: string,
  world: SuppressionWorld,
  prospectId?: string,
): NewlyBlockedFixture {
  return { category, expectedReason, phone, world, prospectId }
}

export function buildNewlyBlockedFixtures(): NewlyBlockedFixture[] {
  const fixtures: NewlyBlockedFixture[] = []

  const prospectLabels = ['dnc_number', 'dnc_contact', 'take_me_off'] as const
  prospectLabels.forEach((label, index) => {
    const phone = fictional(index + 1)
    fixtures.push(row('prospect_dnc', 'prospect_dnc', phone, {
      phones: [{ phone, prospectId: `prospect-dnc-${index}`, lastDisposition: label }],
    }))
  })

  const leadLabels = ['DNC Number', 'dnc-contact', 'take me off'] as const
  leadLabels.forEach((label, index) => {
    const phone = fictional(index + 11)
    fixtures.push(row('lead_dnc', 'lead_dnc', phone, {
      leads: [{ id: `lead-dnc-${index}`, phone, callResult: label }],
      phones: [{ phone, prospectId: `lead-dnc-prospect-${index}`, lastDisposition: 'no_answer' }],
    }))
  })

  const mojoPhone = fictional(21)
  fixtures.push(row('mojo_dnc', 'mojo_dnc', mojoPhone, {
    phones: [{ phone: mojoPhone, prospectId: 'mojo-dnc', lastDisposition: null, phoneConnected: 'connected' }],
    mojoEvents: [{ phone: mojoPhone, outcome: 'dnc', providerContactId: 'mojo-contact-dnc' }],
  }))

  for (let index = 0; index < 31; index += 1) {
    const phone = fictional(100 + index)
    const label = index < 16 ? 'dead' : 'fax'
    fixtures.push(row('dead_or_fax', 'disconnected', phone, {
      phones: [{ phone, prospectId: `dead-${index}`, lastDisposition: label, phoneConnected: 'connected' }],
    }))
  }

  for (let index = 0; index < 12; index += 1) {
    const phone = fictional(200 + index)
    const deadReason = index % 2 === 0 ? 'disconnected' : 'Wrong Or Disconnected'
    fixtures.push(row('disconnected', 'disconnected', phone, {
      leads: [{ id: `dead-reason-${index}`, phone, deadReason, callResult: 'no_answer' }],
      phones: [{ phone, prospectId: `dead-reason-prospect-${index}`, lastDisposition: 'no_answer', phoneConnected: 'dataskip_dnc' }],
    }))
  }

  for (let index = 0; index < 40; index += 1) {
    const phone = fictional(300 + index)
    const anchor = fictional(5000 + index)
    const prospectId = `person-${index}`
    fixtures.push(row('person_fanout', 'person_fanout', phone, {
      phones: [
        { phone: anchor, prospectId, lastDisposition: 'dnc_contact', relationship: 'owner' },
        { phone, prospectId, lastDisposition: 'no_answer', phoneConnected: 'connected', relationship: 'owner' },
      ],
    }, prospectId))
  }

  for (let index = 0; index < 10; index += 1) {
    const phone = fictional(340 + index)
    const leadPhone = fictional(6000 + index)
    const prospectId = `refused-${index}`
    fixtures.push(row('person_fanout', 'person_fanout', phone, {
      leads: [{ id: `refused-lead-${index}`, phone: leadPhone, deadReason: 'dnc_refused', callResult: 'no_answer' }],
      prospects: [{ id: prospectId, leadId: `refused-lead-${index}`, county: 'jackson', street: `${index} elm`, ownerLast: `Lane${index}` }],
      phones: [
        { phone: leadPhone, prospectId, lastDisposition: 'no_answer', relationship: 'owner' },
        { phone, prospectId, lastDisposition: 'busy', phoneConnected: 'connected', relationship: 'owner' },
      ],
    }, prospectId))
  }

  for (let index = 0; index < 10; index += 1) {
    const phone = fictional(350 + index)
    const anchor = fictional(7000 + index)
    const contactId = `contact-${index}`
    fixtures.push(row('person_fanout', 'person_fanout', phone, {
      prospects: [
        { id: `mojo-anchor-${index}`, county: 'clay', street: `${index} main`, ownerLast: `Ng${index}` },
        { id: `mojo-other-${index}`, county: 'platte', street: `${index} broad`, ownerLast: `Owens${index}` },
      ],
      phones: [
        { phone: anchor, prospectId: `mojo-anchor-${index}`, lastDisposition: 'take_me_off', relationship: 'owner' },
        { phone, prospectId: `mojo-other-${index}`, lastDisposition: 'no_answer', phoneConnected: 'connected', relationship: 'owner' },
      ],
      mojoEvents: [
        { phone: anchor, outcome: 'no_answer', providerContactId: contactId },
        { phone, outcome: 'no_answer', providerContactId: contactId },
      ],
    }, `mojo-other-${index}`))
  }

  for (let index = 0; index < 10; index += 1) {
    const phone = fictional(400 + index)
    const anchor = fictional(8000 + index)
    const street = `${index} Oak St.`
    const ownerLast = `Rivera${index}`
    fixtures.push(row('household_fanout', 'household_fanout', phone, {
      prospects: [
        { id: `house-a-${index}`, county: 'Jackson', street, ownerLast },
        { id: `house-b-${index}`, county: 'jackson', street: `${index} oak st`, ownerLast },
      ],
      phones: [
        { phone: anchor, prospectId: `house-a-${index}`, lastDisposition: 'take_me_off', relationship: 'relative' },
        { phone, prospectId: `house-b-${index}`, lastDisposition: 'no_answer', phoneConnected: 'dataskip_dnc', relationship: 'relative' },
      ],
    }, `house-b-${index}`))
  }

  return fixtures
}

export function blockedCategoryCounts(fixtures: readonly NewlyBlockedFixture[]): Record<NewlyBlockedCategory, number> {
  const counts = {
    person_fanout: 0,
    dead_or_fax: 0,
    disconnected: 0,
    household_fanout: 0,
    lead_dnc: 0,
    prospect_dnc: 0,
    mojo_dnc: 0,
  }
  for (const fixture of fixtures) {
    const reason = exportBlockReason(fixture.phone, fixture.world, fixture.prospectId)
    if (reason !== fixture.expectedReason) continue
    counts[fixture.category] += 1
  }
  return counts
}
