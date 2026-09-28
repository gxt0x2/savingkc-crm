import { describe, expect, it } from 'vitest'
import { parseJacksonExcessProceedsCsv } from './csv'
import { claimDeadlineFromSaleDate, claimPeriodElapsed, daysToClaimDeadline, excessProceedsHandoffReady } from '@/types/excess-proceeds'
import { presentExcessProceedsFile } from './present'
import { buildExcessProceedsPatch } from './patch'

const CSV = `Suit No,Parcel No,Owner,Address,Date Sold,Excess,Confirmed,Deed,Set Aside,Refund,Excess App Filed,Excess Paid
24CV-1,12 345,Ada Owner,"10 Main St, Kansas City, MO 64101",1/15/2024,"$2,500.00",2/1/2024,,,,,
24CV-1,12345,Ada Owner Again,10 Main St,1/15/2024,2500,,,,,,
24CV-2,99,SMITH FAMILY TRUST,99 Oak,2024-03-01,10000,,,,,,
`

describe('Jackson excess-proceeds CSV', () => {
  it('parses county columns and rejects a duplicate suit and parcel', () => {
    const parsed = parseJacksonExcessProceedsCsv(CSV)
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toMatchObject({
      suit_no: '24CV-1',
      parcel_no: '12345',
      owner_name: 'Ada Owner',
      property_address: '10 Main St',
      city: 'Kansas City',
      state: 'MO',
      zip: '64101',
      sale_date: '2024-01-15',
      excess_amount: 2500,
      confirmed_date: '2024-02-01',
      owner_is_entity: false,
      zestimate: null,
      score: null,
    })
    expect(parsed.errors.map((error) => error.message)).toContain('Duplicate suit and parcel in this file.')
    expect(parsed.rows[1].owner_is_entity).toBe(true)
  })

  it('does not invent a Zestimate when the as-of date is missing', () => {
    const parsed = parseJacksonExcessProceedsCsv('Suit No,Parcel No,Zestimate\n1,2,250000\n')
    expect(parsed.rows[0].zestimate).toBeNull()
    expect(parsed.rows[0].zestimate_provided).toBe(false)
    expect(parsed.warnings[0].message).toMatch(/does not invent/)
  })

  it('stores a Zestimate only with an as-of date', () => {
    const parsed = parseJacksonExcessProceedsCsv('Suit No,Parcel No,Zestimate,Zestimate As Of\n1,2,"$180,000",2026-09-01\n')
    expect(parsed.rows[0]).toMatchObject({ zestimate: 180000, zestimate_as_of: '2026-09-01', zestimate_provided: true })
    expect(parsed.warnings).toHaveLength(0)
  })
})

describe('Chapter 141 claim clock', () => {
  it('sets the deadline two years after the sale and clamps leap day', () => {
    expect(claimDeadlineFromSaleDate('2024-01-15')).toBe('2026-01-15')
    expect(claimDeadlineFromSaleDate('2024-02-29')).toBe('2026-02-28')
    expect(claimPeriodElapsed('2026-01-15', '2026-01-15')).toBe(false)
    expect(claimPeriodElapsed('2026-01-15', '2026-01-16')).toBe(true)
    expect(daysToClaimDeadline('2026-01-15', '2026-01-13')).toBe(2)
  })

  it('marks a file handoff-ready only when counsel, the form pack, and payout are clear', () => {
    const file = presentExcessProceedsFile({
      id: 'file-1',
      lead_id: 'lead-1',
      suit_no: '24CV-1',
      parcel_no: '99',
      sale_date: '2024-01-15',
      claim_deadline: '2026-01-15',
      excess_amount: '2500.00',
      payout_ready: true,
      counsel_status: 'clear',
      form_pack_status: 'signed',
      surplus_fee_pct: 10,
      zestimate: null,
      leads: { full_name: 'Ada Owner', station: 'new', phone: null },
    }, '2026-01-10')
    expect(file.claim_period_elapsed).toBe(false)
    expect(file.days_to_claim_deadline).toBe(5)
    expect(file.handoff_ready).toBe(true)
    expect(file.zestimate).toBeNull()
    expect(excessProceedsHandoffReady({ ...file, claim_period_elapsed: true })).toBe(false)
  })

  it('refuses a Zestimate without an as-of date', () => {
    expect(buildExcessProceedsPatch({ zestimate: 10 }).ok).toBe(false)
    expect(buildExcessProceedsPatch({ zestimate: null, zestimate_as_of: null }).ok).toBe(true)
  })
})
