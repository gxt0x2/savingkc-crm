import { describe, expect, it } from 'vitest'
import { ownerLineRelease } from '@/lib/dialer-owner-line-release'
import { laneClass, sourceListLanes, worstBlockReason } from '@/lib/dialer-relationship-gate'
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
    expect(relationshipBucket('relative', 'unknown')).toBe('relative')
  })

  it('treats a generic relative as other relative on tax and blocks it on probate', () => {
    expect(relationshipBucket('relative', 'unknown')).toBe('relative')
    expect(relationshipBucket('relative', null)).toBe('relative')
    expect(reason({ relationship: 'relative', ownerType: 'unknown', lane: 'tax_delinquent', title: 'Tax · Deceased' })).toBeNull()
    expect(reason({ relationship: 'relative', ownerType: null, lane: 'probate_estate' })).toBe('relative_not_allowed')
    expect(reason({ relationship: 'relative', ownerType: null, lane: 'inherited_deed' })).toBe('relative_not_allowed')
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
      relationship: 'relative', ownerType: null, lane: 'tax_delinquent',
      ownerName: 'John Smith', ownerLast: 'Smith', contactName: 'John Smith',
    })).toBeNull()
    expect(reason({
      relationship: 'relative', ownerType: null, lane: 'probate_estate',
      ownerName: 'John Smith', ownerLast: 'Smith', contactName: 'John Smith',
    })).toBe('relative_not_allowed')
  })

  it('spreads an ask-off dead lead to every relative and holds other dead leads', () => {
    expect(exportBlockReason(phone, {
      lane: 'tax_delinquent',
      prospects: [{ id: 'home', leadId: 'lead-ask', ownerType: 'person' }],
      phones: [{ phone, prospectId: 'home', relationship: 'child' }],
      leads: [{ id: 'lead-ask', phone: ownerPhone, deadReason: 'please stop calling' }],
    }, 'home')).toBe('property_owner_dnc_fanout')
    expect(exportBlockReason(ownerPhone, {
      lane: 'tax_delinquent',
      leads: [{ id: 'lead-other', phone: ownerPhone, station: 'dead', deadReason: 'not_selling' }],
    })).toBe('dead_manual_review_unread')
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

  it('holds contact 8188 when owner_1_last disagrees with owner_1', () => {
    expect(exportBlockReason('+18165558188', {
      lane: 'tax_delinquent',
      prospects: [{ id: '8188', ownerName: 'OWNER, ADA M', ownerFirst: 'Janet', ownerLast: 'Chapman', deceased: true, ownerType: 'person' }],
      phones: [{ phone: '+18165558188', prospectId: '8188', relationship: 'owner', contactName: 'Ada Owner' }],
    }, '8188')).toBe('deceased_owner_line')
    expect(exportBlockReason('+18165558188', {
      lane: 'tax_delinquent',
      prospects: [{ id: '8188', ownerName: 'OWNER, ADA M', ownerFirst: 'Janet', ownerLast: 'Chapman', deceased: true, ownerType: 'person' }],
      phones: [{ phone: '+18165558188', prospectId: '8188', relationship: 'subject', contactName: 'Ada M Owner' }],
    }, '8188')).toBe('deceased_owner_line')
  })

  it('holds a joint owner when the contact uses the first person surname', () => {
    expect(exportBlockReason('+18165558188', {
      lane: 'tax_delinquent',
      prospects: [{ id: 'joint', ownerName: 'JOHN SMITH AND MARY JONES', deceased: true, ownerType: 'person' }],
      phones: [{ phone: '+18165558188', prospectId: 'joint', relationship: 'owner', contactName: 'Smith' }],
    }, 'joint')).toBe('deceased_owner_line')
  })

  it('holds a last-first joint owner when the contact is John Smith', () => {
    expect(exportBlockReason('+18165558188', {
      lane: 'tax_delinquent',
      prospects: [{ id: 'joint', ownerName: 'SMITH JOHN & MARY', deceased: true, ownerType: 'person' }],
      phones: [{ phone: '+18165558188', prospectId: 'joint', relationship: 'owner', contactName: 'John Smith' }],
    }, 'joint')).toBe('deceased_owner_line')
  })

  it('holds the 756bcafd shape when owner_1_last matches and the trailing word does not', () => {
    expect(exportBlockReason('+18165558188', {
      lane: 'tax_delinquent',
      prospects: [{ id: '756bcafd', ownerName: 'MARY JONES & DAVID CHARLES', ownerFirst: 'Janet', ownerLast: 'Smith', deceased: true, ownerType: 'person' }],
      phones: [{ phone: '+18165558188', prospectId: '756bcafd', relationship: 'owner', contactName: 'Smith' }],
    }, '756bcafd')).toBe('deceased_owner_line')
  })

  it('holds a suffixed owner name when the contact uses the surname', () => {
    expect(exportBlockReason('+18165558188', {
      lane: 'tax_delinquent',
      prospects: [{ id: 'suffix', ownerName: 'JOHN A SMITH JR TRUSTEE', deceased: true, ownerType: 'person' }],
      phones: [{ phone: '+18165558188', prospectId: 'suffix', relationship: 'owner', contactName: 'Smith' }],
    }, 'suffix')).toBe('deceased_owner_line')
  })

  it('keeps a generic relative dialable when the surname matches no owner person', () => {
    expect(exportBlockReason('+18165558188', {
      lane: 'tax_delinquent',
      prospects: [{ id: 'rel', ownerName: 'JOHN SMITH AND MARY JONES', deceased: true, ownerType: 'person' }],
      phones: [{ phone: '+18165558188', prospectId: 'rel', relationship: 'relative', contactName: 'Grant Other' }],
    }, 'rel')).toBeNull()
  })

  it('holds a deceased owner line when owner_1 is null', () => {
    expect(exportBlockReason('+18165558188', {
      lane: 'tax_delinquent',
      prospects: [{ id: '8188', ownerName: null, ownerFirst: 'Janet', ownerLast: 'Chapman', deceased: true, ownerType: 'person' }],
      phones: [{ phone: '+18165558188', prospectId: '8188', relationship: 'owner', contactName: 'Ada Owner' }],
    }, '8188')).toBe('deceased_owner_line')
  })

  it('holds decedent contact 8273 and not unrelated owners on 0ffc6445 or e783be2e', () => {
    expect(exportBlockReason('+18165558273', {
      lane: 'tax_delinquent', listTitle: 'Tax · Deceased',
      prospects: [{ id: '8273', ownerName: 'Ada Owner', ownerFirst: 'Ada', ownerLast: 'Owner', deceased: true, ownerType: 'person' }],
      phones: [{ phone: '+18165558273', prospectId: '8273', relationship: 'owner', contactName: 'Ada Owner' }],
    }, '8273')).toBe('deceased_owner_line')
    expect(exportBlockReason('+18165558273', {
      lane: 'tax_delinquent',
      prospects: [{ id: '8273', deceased: true, ownerType: 'person' }],
      phones: [{ phone: '+18165558273', prospectId: '8273', relationship: 'decedent', contactName: 'Someone Else' }],
    }, '8273')).toBe('deceased_owner_line')
    for (const id of ['0ffc6445', 'e783be2e']) {
      expect(exportBlockReason('+18165558001', {
        lane: 'tax_delinquent',
        prospects: [{ id, ownerName: 'Record Owner', ownerFirst: 'Record', ownerLast: 'Owner', deceased: true }],
        phones: [{ phone: '+18165558001', prospectId: id, relationship: 'owner', contactName: 'Unrelated Person' }],
      }, id)).toBeNull()
    }
  })

  it('fails closed when the lane is unknown and ignores a code-violation link', () => {
    expect(laneClass([])).toBe('closed')
    expect(sourceListLanes({ linkedLanes: ['code_violation'], title: 'Tax · Deceased' })).toEqual([])
    expect(reason({ relationship: 'parent', ownerType: 'person' })).toBe('relative_not_allowed')
    expect(reason({ relationship: 'parent', ownerType: 'person', lane: 'tax_delinquent' })).toBeNull()
  })

  it('does not release ABC Holdings Member or an agent-service contact', () => {
    expect(reason({
      relationship: 'entity_contact', contactName: 'ABC Holdings Member', ownerName: 'ABC Holdings LLC',
      verifiedSource: 'missouri_sos_filing', lane: 'tax_delinquent',
    })).toBe('relationship_unknown')
    expect(reason({
      relationship: 'entity_contact', contactName: 'CT Corporation', ownerName: 'Oak LLC',
      verifiedSource: 'missouri_sos_filing', lane: 'tax_delinquent',
    })).toBe('relationship_unknown')
  })

  it('releases an unknown row only through the owner-line release', () => {
    expect(reason({
      relationship: 'unknown', contactName: 'Officer', ownerName: 'Ada Owner', ownerLast: 'Owner', ownerType: 'person', lane: 'tax_delinquent',
    })).toBe('relationship_unknown')
    expect(reason({
      relationship: 'unknown', contactName: 'Ada Owner', ownerName: 'Ada Owner', ownerLast: 'Owner', ownerType: 'person', lane: 'tax_delinquent',
    })).toBeNull()
  })

  it('keeps the most restrictive reason when one row is clear', () => {
    expect(worstBlockReason([null, 'relative_not_allowed', 'relationship_unknown'])).toBe('relationship_unknown')
    expect(worstBlockReason([null, null])).toBeNull()
  })

  it('lifts an associate block only when the prospect is set', () => {
    const shared = '+18165550911'
    const world = {
      lane: 'tax_delinquent' as const,
      prospects: [{ id: 'home', ownerType: 'person' }, { id: 'other', ownerType: 'person' }],
      phones: [
        { phone: shared, prospectId: 'home', relationship: 'owner' },
        { phone: shared, prospectId: 'other', relationship: 'associate' },
      ],
    }
    expect(exportBlockReason(shared, world, 'home')).toBeNull()
    expect(exportBlockReason(shared, world, 'other')).toBe('associate')
    expect(exportBlockReason(shared, world)).toBe('associate')
  })

  it('uses the most restrictive source-list lane when several match', () => {
    expect(laneClass(['tax_delinquent', 'probate_estate'])).toBe('probate')
    expect(reason({ relationship: 'parent', ownerType: 'person', lanes: ['tax_delinquent', 'inherited_deed'], title: 'Tax · Deceased' })).toBe('relative_not_allowed')
  })
})
