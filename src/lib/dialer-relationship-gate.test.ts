import { describe, expect, it } from 'vitest'
import { ownerLineRelease } from '@/lib/dialer-owner-line-release'
import { laneClass, sourceListLanes } from '@/lib/dialer-relationship-gate'
import { campaignMemberOffered, exportBlockReason, relationshipBucket } from '@/lib/dialer-suppression-policy'

const phone = '+18165550901'
const ownerPhone = '+18165550900'

function reason(input: {
  relationship?: string | null
  ownerType?: string | null
  lane?: string | null
  source?: string | null
  lanes?: string[]
  title?: string | null
  contactName?: string | null
  ownerName?: string | null
  ownerLast?: string | null
  skipTraced?: boolean | null
  verifiedSource?: string | null
  entityRole?: string | null
  lastDisposition?: string | null
  voiceHold?: boolean | null
  ownerDisposition?: string | null
  ownerVoiceHold?: boolean | null
  ownerOptOut?: boolean
}) {
  return exportBlockReason(phone, {
    lane: input.lane,
    source: input.source,
    lanes: input.lanes,
    listTitle: input.title,
    prospects: [{
      id: 'home',
      ownerType: input.ownerType,
      ownerName: input.ownerName,
      ownerLast: input.ownerLast,
      skipTraced: input.skipTraced,
      parcelId: 'P-1',
      county: 'jackson',
      street: '1 Main',
      zip: '64111',
    }],
    phones: [
      {
        phone,
        prospectId: 'home',
        relationship: input.relationship,
        contactName: input.contactName,
        verifiedSource: input.verifiedSource,
        entityRole: input.entityRole,
        lastDisposition: input.lastDisposition,
        voiceHold: input.voiceHold,
      },
      {
        phone: ownerPhone,
        prospectId: 'home',
        relationship: 'owner',
        contactName: input.ownerName,
        lastDisposition: input.ownerDisposition,
        voiceHold: input.ownerVoiceHold,
      },
    ],
    optOuts: input.ownerOptOut ? [{ phone: ownerPhone, optedOut: true }] : [],
  }, 'home')
}

describe('counsel relationship gate', () => {
  it('keeps a parent, in-law, and other relative dialable on a tax lane with no owner DNC', () => {
    for (const relationship of ['parent', 'in-law', 'other_relative'] as const) {
      expect(reason({ relationship, lane: 'tax_delinquent', ownerType: 'person' })).toBeNull()
    }
  })

  it('blocks parent, in-law, and other relative on probate and inherited lanes and keeps PR, on-title, spouse, child, and sibling', () => {
    for (const lane of ['probate_estate', 'inherited_deed', 'inherited', 'probate_no_property']) {
      for (const relationship of ['parent', 'in_law', 'other_relative']) {
        expect(reason({ relationship, lane, ownerType: 'person' })).toBe('relative_not_allowed')
      }
      for (const relationship of ['personal_representative', 'pr', 'on_title', 'on_title_owner', 'co_owner', 'spouse', 'child', 'sibling']) {
        expect(reason({ relationship, lane, ownerType: 'person' })).toBeNull()
      }
    }
  })

  it('blocks a null type and the relationship zzz as relationship_unknown', () => {
    expect(reason({ relationship: null, ownerType: null })).toBe('relationship_unknown')
    expect(reason({ relationship: '', ownerType: '' })).toBe('relationship_unknown')
    expect(reason({ relationship: 'zzz', ownerType: 'spouse' })).toBe('relationship_unknown')
  })

  it('does not accept individual as a family owner type', () => {
    expect(relationshipBucket(null, 'individual')).toBe('relationship_unknown')
    expect(relationshipBucket('relative', 'Individual')).toBe('relationship_unknown')
    expect(reason({ relationship: 'relative', ownerType: 'individual' })).toBe('relationship_unknown')
  })

  it('blocks a generic relative with no family possible type', () => {
    expect(relationshipBucket('relative', null)).toBe('relationship_unknown')
    expect(reason({ relationship: 'relative', ownerType: null, contactName: 'Ann Other', ownerName: 'John Smith', ownerLast: 'Smith' })).toBe('relationship_unknown')
  })

  it('treats a generic relative as family when a family possible type is present', () => {
    for (const ownerType of ['parent', 'in_law', 'spouse', 'child', 'sibling', 'other_relative']) {
      expect(relationshipBucket('relative', ownerType)).toBe('relative')
    }
    expect(reason({ relationship: 'relative', ownerType: 'spouse', lane: 'tax_delinquent' })).toBeNull()
    expect(reason({ relationship: 'relative', ownerType: 'parent', lane: 'probate_estate' })).toBe('relative_not_allowed')
  })

  it('keeps a generic relative whose contact name matches the owner under the owner-line release', () => {
    expect(ownerLineRelease({
      relationship: 'relative',
      ownerType: 'person',
      ownerName: 'John Smith',
      ownerLast: 'Smith',
      contactName: 'John Smith',
      skipTraced: false,
    })).toBe(true)
    expect(reason({
      relationship: 'relative',
      ownerType: null,
      ownerName: 'John Smith',
      ownerLast: 'Smith',
      contactName: 'John Smith',
    })).toBeNull()
  })

  it('blocks an owner DNC contact from every relative phone', () => {
    expect(reason({ relationship: 'child', lane: 'tax_delinquent', ownerDisposition: 'dnc_contact' })).toBe('property_owner_dnc_fanout')
  })

  it('blocks an owner DNC number from every relative phone', () => {
    expect(reason({ relationship: 'sibling', lane: 'probate_estate', ownerDisposition: 'dnc_number' })).toBe('property_owner_dnc_fanout')
  })

  it('blocks an owner take-me-off from every relative phone', () => {
    expect(reason({ relationship: 'spouse', lane: 'tax_delinquent', ownerDisposition: 'take_me_off' })).toBe('property_owner_dnc_fanout')
  })

  it('blocks an owner opt-out from every relative phone', () => {
    expect(reason({ relationship: 'child', lane: 'inherited_deed', ownerOptOut: true })).toBe('property_owner_dnc_fanout')
  })

  it('blocks an owner voice hold from every relative phone', () => {
    expect(reason({ relationship: 'parent', lane: 'tax_delinquent', title: 'Tax · Deceased', ownerVoiceHold: true })).toBe('property_owner_dnc_fanout')
  })

  it('excludes a CRM campaign member whose phone is blocked', () => {
    expect(campaignMemberOffered({
      status: 'active',
      lane: 'tax_delinquent',
      title: 'Tax · Deceased',
      phones: [{ phone, relationship: 'associate', ownerType: 'person' }],
    })).toBe(false)
    expect(campaignMemberOffered({
      status: 'active',
      lane: 'tax_delinquent',
      phones: [{ phone, relationship: 'spouse', ownerType: 'person' }],
    })).toBe(true)
  })

  it('blocks relationship associate on a tax lane and does not block the owner number', () => {
    expect(reason({ relationship: 'associate', lane: 'tax_delinquent', title: 'Tax · Deceased' })).toBe('associate')
    const shared = '+18165550911'
    expect(exportBlockReason(shared, {
      lane: 'tax_delinquent',
      prospects: [
        { id: 'home', ownerType: 'person', ownerName: 'Ada Owner' },
        { id: 'other', ownerType: 'person' },
      ],
      phones: [
        { phone: shared, prospectId: 'home', relationship: 'owner', contactName: 'Ada Owner' },
        { phone: shared, prospectId: 'other', relationship: 'associate' },
      ],
    }, 'home')).toBeNull()
    expect(exportBlockReason(shared, {
      lane: 'tax_delinquent',
      prospects: [
        { id: 'home', ownerType: 'person' },
        { id: 'other', ownerType: 'person' },
      ],
      phones: [
        { phone: shared, prospectId: 'home', relationship: 'owner' },
        { phone: shared, prospectId: 'other', relationship: 'associate' },
      ],
    }, 'other')).toBe('associate')
  })

  it('blocks entity_contact by default and releases an SOS officer only off probate and deceased sources', () => {
    expect(reason({ relationship: 'entity_contact', ownerType: 'Corporate', ownerName: 'Oak LLC', lane: 'tax_delinquent' })).toBe('relationship_unknown')
    expect(reason({
      relationship: 'entity_contact',
      ownerType: 'Corporate',
      ownerName: 'Oak LLC',
      contactName: 'Jane Smith',
      entityRole: 'officer',
      verifiedSource: 'missouri_sos_filing',
      lane: 'tax_delinquent',
      title: 'Tax · Deceased',
    })).toBeNull()
    expect(reason({
      relationship: 'entity_contact',
      ownerType: 'Corporate',
      ownerName: 'Oak LLC',
      contactName: 'Jane Smith',
      entityRole: 'officer',
      verifiedSource: 'missouri_sos_filing',
      lane: 'deceased',
    })).toBe('relationship_unknown')
    expect(reason({
      relationship: 'entity_contact',
      ownerType: 'Corporate',
      ownerName: 'Oak LLC',
      contactName: 'Jane Smith',
      entityRole: 'officer',
      verifiedSource: 'missouri_sos_filing',
      lane: 'probate_estate',
    })).toBe('relationship_unknown')
  })

  it('blocks a registered agent', () => {
    expect(reason({ relationship: 'entity_contact', contactName: 'Registered Agent', ownerName: 'Oak LLC', lane: 'tax_delinquent' })).toBe('relationship_unknown')
    expect(reason({ relationship: 'registered_agent', ownerName: 'John Smith', contactName: 'John Smith', lane: 'tax_delinquent' })).toBe('relationship_unknown')
  })

  it('keeps a parent allowed on a tax list titled Tax · Deceased', () => {
    expect(sourceListLanes({ lane: 'tax_delinquent', title: 'Tax · Deceased' })).toEqual(['tax_delinquent'])
    expect(laneClass(['tax_delinquent'])).toBe('open')
    expect(reason({ relationship: 'parent', ownerType: 'person', lane: 'tax_delinquent', title: 'Tax · Deceased' })).toBeNull()
  })

  it('blocks the decedent own owner phone on a tax lane', () => {
    expect(reason({ relationship: 'deceased_owner_line', ownerType: 'person', lane: 'tax_delinquent', title: 'Tax · Deceased' })).toBe('deceased_owner_line')
  })

  it('uses the most restrictive source-list lane when several match', () => {
    expect(laneClass(['tax_delinquent', 'probate_estate'])).toBe('probate')
    expect(reason({ relationship: 'parent', ownerType: 'person', lanes: ['tax_delinquent', 'inherited_deed'], title: 'Tax · Deceased' })).toBe('relative_not_allowed')
  })
})
