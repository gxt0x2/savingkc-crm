import { describe, expect, it } from 'vitest'
import { OWNER_LINE_NICKNAMES, ownerLineRelease, type OwnerLineReleaseInput } from './dialer-owner-line-release'

function release(overrides: OwnerLineReleaseInput): boolean {
  return ownerLineRelease({
    relationship: 'owner',
    ownerType: 'person',
    skipTraced: true,
    verifiedSource: 'dataskip_run_1',
    ...overrides,
  })
}

describe('owner line release', () => {
  it('keeps an explicit nickname table and does not guess past it', () => {
    const pairs = OWNER_LINE_NICKNAMES.map(([short, full]) => `${short}/${full}`)
    expect(pairs).toEqual(expect.arrayContaining(['bill/william', 'bob/robert', 'liz/elizabeth']))
    expect(pairs).not.toContain('diana/diane')
    expect(pairs).not.toContain('peggy/margaret')
  })

  describe('O1 a named person, not a company', () => {
    it('releases a person named on the owner line', () => {
      expect(release({ ownerName: 'John Smith', ownerLast: 'Smith', contactName: 'John Smith' })).toBe(true)
      expect(release({
        relationship: 'associate',
        ownerName: 'John Smith',
        ownerLast: 'Smith',
        contactName: 'John Smith',
      })).toBe(true)
    })

    it('blocks an LLC, Inc, Trust, or Bank', () => {
      expect(release({ ownerName: 'Oak LLC', ownerLast: 'LLC', contactName: 'Oak LLC' })).toBe(false)
      expect(release({ ownerName: 'Acme Inc', ownerLast: 'Inc', contactName: 'Acme Inc' })).toBe(false)
      expect(release({ ownerName: 'Acme Incorporated', ownerLast: 'Incorporated', contactName: 'Acme Incorporated' })).toBe(false)
      expect(release({ ownerName: 'Smith Family Trust', ownerLast: 'Trust', contactName: 'Smith Family' })).toBe(false)
      expect(release({ ownerName: 'First National Bank', ownerLast: 'Bank', contactName: 'First National' })).toBe(false)
    })

    it('counts a trustee only when a person is named as trustee', () => {
      expect(release({ ownerName: 'John Smith, Trustee', ownerLast: 'Smith', contactName: 'John Smith' })).toBe(true)
      expect(release({
        ownerName: 'John Smith Trustee of the Smith Trust',
        ownerLast: 'Smith',
        contactName: 'John Smith',
      })).toBe(true)
      expect(release({
        ownerName: 'Alden Jimmie C & Nora A-Trustees',
        ownerLast: 'Alden',
        contactName: 'Nora Alden',
      })).toBe(true)
      expect(release({ ownerName: 'Smith Family Trust', ownerLast: 'Smith', contactName: 'Smith Trust' })).toBe(false)
      expect(release({
        ownerName: 'John Smith & Acme LLC',
        ownerLast: 'Smith',
        contactName: 'Acme LLC',
      })).toBe(false)
      expect(release({
        ownerName: 'John Smith & Acme LLC',
        ownerLast: 'Smith',
        contactName: 'John Smith',
      })).toBe(true)
    })
  })

  describe('O2 co-owner last name and an explicit nickname', () => {
    it('gives Mary the carried last name in John & Mary Smith', () => {
      expect(release({ ownerName: 'John & Mary Smith', ownerLast: 'Smith', contactName: 'Mary Smith' })).toBe(true)
      expect(release({ ownerName: 'John & Mary Smith', ownerLast: 'Smith', contactName: 'John Smith' })).toBe(true)
    })

    it('reads a county owner line, including a co-owner last name and a leading initial', () => {
      expect(release({
        ownerName: 'Alden Marcus S & Nora',
        ownerLast: 'Alden',
        contactName: 'Nora Alden',
      })).toBe(true)
      expect(release({
        ownerName: 'Alden Nancy L & Brook Robert L',
        ownerLast: 'Alden',
        contactName: 'Robert Brook',
      })).toBe(true)
      expect(release({
        ownerName: 'Parker Owen E & E Lila',
        ownerLast: 'Parker',
        contactName: 'Lila Parker',
      })).toBe(true)
      expect(release({
        ownerName: 'Alden Walter C & Nora Jane',
        ownerLast: 'Alden',
        contactName: 'Nora Alden',
      })).toBe(true)
      expect(release({
        ownerName: 'Alden Reginald T & Brook Johnetta',
        ownerLast: 'Alden',
        contactName: 'Johnetta Brook',
      })).toBe(true)
      expect(release({
        ownerName: 'Alden Lynn & Brook Earl M Jr',
        ownerLast: 'Alden',
        contactName: 'Earl Brook',
      })).toBe(true)
      expect(release({
        ownerName: 'Alden Ricky & Alden Ronald',
        ownerLast: 'Alden',
        contactName: 'Ronald Alden',
      })).toBe(true)
      expect(release({
        ownerName: 'Alden Marcus L Jr & Nora',
        ownerLast: 'Alden Jr',
        contactName: 'Nora Alden',
      })).toBe(true)
    })

    it('accepts Bill/William, Bob/Robert, and Liz/Elizabeth', () => {
      expect(release({ ownerName: 'William & Mary Smith', ownerLast: 'Smith', contactName: 'Bill Smith' })).toBe(true)
      expect(release({ ownerName: 'Robert Smith', ownerLast: 'Smith', contactName: 'Bob Smith' })).toBe(true)
      expect(release({ ownerName: 'Elizabeth Smith', ownerLast: 'Smith', contactName: 'Liz Smith' })).toBe(true)
    })

    it('blocks a different last name, a surname-only contact, and a short form that is not in the table', () => {
      expect(release({ ownerName: 'John & Mary Smith', ownerLast: 'Smith', contactName: 'Mary Jones' })).toBe(false)
      expect(release({ ownerName: 'Fay Uno', ownerLast: 'Uno', contactName: 'Gus Uno' })).toBe(false)
      expect(release({
        ownerName: 'Alden Brenda Sue & Alden Carol Sue',
        ownerLast: 'Alden',
        contactName: 'Judy Alden',
      })).toBe(false)
      expect(release({ ownerName: 'Dearing John & Diane', ownerLast: 'Dearing', contactName: 'Diana Dearing' })).toBe(false)
      expect(release({ ownerName: 'Roy Huggins & Christine', ownerLast: 'Huggins', contactName: 'Christine Leiker' })).toBe(false)
      expect(release({ ownerName: 'Margaret Smith', ownerLast: 'Smith', contactName: 'Peggy Smith' })).toBe(false)
      expect(release({ relationship: 'registered_agent', ownerName: 'John Smith', ownerLast: 'Smith', contactName: 'John Smith' })).toBe(false)
    })
  })

  describe('O3 middle names', () => {
    it('matches the same first and last when the middle name differs or is missing', () => {
      expect(release({ ownerName: 'James Robert Smith', ownerLast: 'Smith', contactName: 'James Smith' })).toBe(true)
      expect(release({ ownerName: 'James Robert Smith', ownerLast: 'Smith', contactName: 'James Q Smith' })).toBe(true)
      expect(release({ ownerName: 'James Robert Smith', ownerLast: 'Smith', contactName: 'James Robert Smith' })).toBe(true)
      expect(release({ ownerName: 'Smith James R', ownerLast: 'Smith', contactName: 'James Smith' })).toBe(true)
    })

    it('releases a middle name used as the first name only when skip trace returned that phone', () => {
      expect(release({
        ownerName: 'James Robert Smith',
        ownerLast: 'Smith',
        contactName: 'Robert Smith',
        skipTraced: true,
      })).toBe(true)
      expect(release({
        ownerName: 'James Robert Smith',
        ownerLast: 'Smith',
        contactName: 'Bob Smith',
        verifiedSource: 'dataskip_run1',
      })).toBe(true)
      expect(release({
        ownerName: 'James Robert Smith',
        ownerLast: 'Smith',
        contactName: 'Robert Smith',
        skipTraced: false,
      })).toBe(false)
      expect(release({
        ownerName: 'James Robert Smith',
        ownerLast: 'Smith',
        contactName: 'Robert Smith',
        verifiedSource: 'manual',
      })).toBe(false)
    })
  })

  describe('O4 estate, heir, deceased, and care-of markers', () => {
    it('never matches et al, heirs of, estate of, deceased, or c/o', () => {
      expect(release({ ownerName: 'John Smith et al', ownerLast: 'Smith', contactName: 'John Smith' })).toBe(false)
      expect(release({ ownerName: 'Heirs of John Smith', ownerLast: 'Smith', contactName: 'John Smith' })).toBe(false)
      expect(release({ ownerName: 'Estate of John Smith', ownerLast: 'Smith', contactName: 'John Smith' })).toBe(false)
      expect(release({ ownerName: 'John Smith deceased', ownerLast: 'Smith', contactName: 'John Smith' })).toBe(false)
      expect(release({ ownerName: 'John Smith c/o Jane Doe', ownerLast: 'Smith', contactName: 'John Smith' })).toBe(false)
      expect(release({ ownerName: 'John Smith c/o Jane Doe', ownerLast: 'Smith', contactName: 'Jane Doe' })).toBe(false)
      expect(release({ ownerName: 'John Smith', ownerLast: 'Smith', contactName: 'John Smith et al' })).toBe(false)
    })
  })

  describe('Pat 4f owner type and Pat 4g skip source', () => {
    const coOwner = {
      ownerName: 'John & Mary Smith',
      ownerLast: 'Smith',
      contactName: 'Mary Smith',
      ownerType: 'person' as const,
      skipTraced: true,
      verifiedSource: 'dataskip_run_1',
    }

    it('keeps a skip-sourced spouse, parent, and unknown relationship blocked', () => {
      expect(release({ ...coOwner, relationship: 'spouse' })).toBe(false)
      expect(release({ ...coOwner, relationship: 'parent' })).toBe(false)
      expect(release({ ...coOwner, relationship: 'unknown' })).toBe(false)
    })

    it('blocks an owner with a mojo source or a null source', () => {
      expect(release({ ...coOwner, relationship: 'owner', verifiedSource: 'mojo_call' })).toBe(false)
      expect(release({ ...coOwner, relationship: 'owner', verifiedSource: 'mojo_import' })).toBe(false)
      expect(release({ ...coOwner, relationship: 'owner', verifiedSource: null })).toBe(false)
      expect(release({ ...coOwner, relationship: 'owner', verifiedSource: 'subject' })).toBe(false)
      expect(release({ ...coOwner, relationship: 'owner', verifiedSource: 'auto' })).toBe(false)
      expect(release({ ...coOwner, relationship: 'owner', verifiedSource: 'manual' })).toBe(false)
    })

    it('blocks a null owner type with an LLC name', () => {
      expect(release({
        ownerType: null,
        relationship: 'owner',
        ownerName: 'Oak LLC',
        ownerLast: 'LLC',
        contactName: 'Oak LLC',
      })).toBe(false)
      expect(release({
        ownerType: null,
        relationship: 'owner',
        ownerName: 'Jane Smith LLC',
        ownerLast: 'Smith',
        contactName: 'Jane Smith',
      })).toBe(false)
    })

    it('accepts person and individual, and blocks every other owner type', () => {
      expect(release({
        ownerType: 'Individual',
        relationship: 'unknown',
        skipTraced: false,
        verifiedSource: null,
        ownerName: 'John Smith',
        ownerLast: 'Smith',
        contactName: 'John Smith',
      })).toBe(true)
      expect(release({
        ownerType: 'individual',
        relationship: 'unknown',
        skipTraced: false,
        verifiedSource: null,
        ownerName: 'John Smith',
        ownerLast: 'Smith',
        contactName: 'John Smith',
      })).toBe(true)
      expect(release({
        ownerType: 'PERSON',
        relationship: 'unknown',
        skipTraced: false,
        verifiedSource: null,
        ownerName: 'John Smith',
        ownerLast: 'Smith',
        contactName: 'John Smith',
      })).toBe(true)
      expect(release({
        ownerType: 'Coworker',
        relationship: 'unknown',
        skipTraced: false,
        verifiedSource: null,
        ownerName: 'John Smith',
        ownerLast: 'Smith',
        contactName: 'John Smith',
      })).toBe(false)
      expect(release({
        ownerType: 'LLC',
        relationship: 'unknown',
        skipTraced: false,
        verifiedSource: null,
        ownerName: 'John Smith',
        ownerLast: 'Smith',
        contactName: 'John Smith',
      })).toBe(false)
    })

    it('blocks a null owner type company name and still releases John Smith', () => {
      expect(release({
        ownerType: null,
        relationship: 'unknown',
        skipTraced: false,
        verifiedSource: null,
        ownerName: 'Oak Properties',
        ownerLast: 'Properties',
        contactName: 'Oak Properties',
      })).toBe(false)
      expect(release({
        ownerType: null,
        relationship: 'unknown',
        skipTraced: false,
        verifiedSource: null,
        ownerName: 'John Smith',
        ownerLast: 'Smith',
        contactName: 'John Smith',
      })).toBe(true)
    })

    it('releases a null owner type with a clean person name', () => {
      expect(release({
        ownerType: null,
        relationship: 'unknown',
        skipTraced: false,
        verifiedSource: null,
        ownerName: 'Jane Doe',
        ownerLast: 'Doe',
        contactName: 'Jane Doe',
      })).toBe(true)
    })

    it('releases a person owner from dataskip_run_x when skip traced', () => {
      expect(release({
        ...coOwner,
        relationship: 'owner',
        verifiedSource: 'dataskip_run_x',
      })).toBe(true)
      expect(release({
        ownerType: 'person',
        relationship: 'owner',
        skipTraced: true,
        verifiedSource: 'smartskip_batch',
        ownerName: 'James Robert Smith',
        ownerLast: 'Smith',
        contactName: 'James Smith',
      })).toBe(true)
    })
  })
})
