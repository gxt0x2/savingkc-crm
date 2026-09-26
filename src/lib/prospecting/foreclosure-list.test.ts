import { describe, expect, it } from 'vitest'
import {
  foreclosureClearsDialFloor,
  foreclosureCountyState,
  foreclosureListHasPhone,
  foreclosureListPhone,
  foreclosureMoney,
  foreclosureNoticeBadge,
  foreclosureOwnerLabel,
  foreclosureOwnerLines,
  foreclosurePersonLabel,
  foreclosurePostalAddress,
  foreclosureSalePresentation,
  foreclosureStreetLine,
  foreclosureStreetParts,
  sortForeclosureList,
} from '@/lib/prospecting/foreclosure-list'

describe('foreclosure list display', () => {
  it('shows an em dash for a missing or unknown owner', () => {
    expect(foreclosureOwnerLabel('')).toBe('—')
    expect(foreclosureOwnerLabel('  UNKNOWN  ')).toBe('—')
    expect(foreclosureOwnerLabel('Unknown')).toBe('—')
    expect(foreclosureOwnerLabel('Juan Ramon Corpus Jr')).toBe('Juan Corpus Jr')
    expect(foreclosureOwnerLines('HALL BENJAMIN PATRICK; HALL CHRISTINE PAIGE')).toEqual([
      'Owner 1 Benjamin Hall',
      'Owner 2 Christine Hall',
    ])
    expect(foreclosureOwnerLines('HALL, BENJAMIN, PATRICK')).toEqual(['Benjamin Hall'])
    expect(foreclosureOwnerLines('JUANITA IZORA JONES')).toEqual(['Juanita Jones'])
    expect(foreclosureOwnerLines('JENNIFER M CARR')).toEqual(['Jennifer Carr'])
    expect(foreclosureOwnerLines('ACKER REX T, ACKER KATHLE')).toEqual([
      'Owner 1 Rex Acker',
      'Owner 2 Kathle Acker',
    ])
    expect(foreclosureOwnerLines('KEINAN PROPERTIES LLC')).toEqual(['Keinan Properties LLC'])
    expect(foreclosureOwnerLines('Ernest Dodson')).toEqual(['Ernest Dodson'])
    expect(foreclosurePersonLabel('HALL BENJAMIN PATRICK', 'HALL BENJAMIN PATRICK; HALL CHRISTINE PAIGE')).toBe('Benjamin Hall')
    expect(foreclosurePersonLabel('Morgan Dodson', 'Ernest Dodson')).toBe('Morgan Dodson')
    expect(foreclosureOwnerLines('Jordan S. Stivers & Roxann')).toEqual([
      'Owner 1 Jordan Stivers',
      'Owner 2 Roxann',
    ])
    expect(foreclosureClearsDialFloor(150000)).toBe(true)
    expect(foreclosureClearsDialFloor(null)).toBe(true)
    expect(foreclosureClearsDialFloor(10000)).toBe(false)
  })

  it('keeps the situs street and drops city, state, ZIP, and the county echo', () => {
    expect(foreclosureStreetLine('100 Sandbox Court', { city: 'Kansas City', state: 'MO', zip: '64108' })).toBe('100 Sandbox Court')
    expect(foreclosureStreetLine('7125 Park Rd, Kansas City, MO 64129, Kansas City MO', {
      city: 'Kansas City',
      state: 'MO',
      zip: '64129',
    })).toBe('7125 Park Rd')
    expect(foreclosureStreetLine('2113 - 2115 Askew Ave, Kansas City, MO 64127, Kansas City MO', {
      city: 'Kansas City',
      state: 'MO',
      zip: '64127',
    })).toBe('2113 - 2115 Askew Ave')
    expect(foreclosureStreetLine('8205 W 153rd St, Overland Park, KS 66223, Overland Park KS', {
      city: 'Overland Park',
      state: 'KS',
      zip: '66223',
    })).toBe('8205 W 153rd St')
    expect(foreclosureStreetLine(null)).toBe('—')
    expect(foreclosureStreetParts('11922 Tomahawk Creek Pkwy #J', { city: 'Leawood', state: 'KS', zip: '66209' })).toEqual({
      street: '11922 Tomahawk Creek Pkwy',
      unit: '#J',
    })
    expect(foreclosurePostalAddress('401 N Locust St, Gardner, KS 66030, Gardner KS 66030', {
      city: 'Gardner',
      state: 'KS',
      zip: '66030',
    })).toBe('401 N Locust St, Gardner, KS 66030')
    expect(foreclosurePostalAddress('10 Main St', { city: 'Belton, Belton', state: 'MO, MO', zip: '64012, 64012' })).toBe('10 Main St, Belton, MO 64012')
  })

  it('labels county and state, money, notice type, and phone_1', () => {
    expect(foreclosureCountyState('jackson', 'MO')).toBe('Jackson MO')
    expect(foreclosureCountyState('johnson', 'KS')).toBe('Johnson KS')
    expect(foreclosureCountyState('wyandotte', 'ks')).toBe('Wyandotte KS')
    expect(foreclosureMoney(150000)).toBe('$150,000')
    expect(foreclosureMoney(null)).toBe('—')
    expect(foreclosureNoticeBadge('sheriff_sale')).toBe('Sheriff sale')
    expect(foreclosureNoticeBadge('nod')).toBe('NOD')
    expect(foreclosureNoticeBadge(null)).toBeNull()
    expect(foreclosureListPhone(['+19137179716'])).toBe('(913) 717-9716')
    expect(foreclosureListPhone([])).toBe('—')
    expect(foreclosureListHasPhone(['+19137179716'])).toBe(true)
    expect(foreclosureListHasPhone([])).toBe(false)
  })

  it('tints a computed sale date and sorts sale date and equity with blanks last', () => {
    expect(foreclosureSalePresentation('2026-10-15', '2026-09-25')).toMatchObject({
      label: '10/15/2026',
      days: 20,
      tone: 'near',
    })
    expect(foreclosureSalePresentation(null, '2026-09-25').tone).toBe('none')

    const rows = [
      { id: 'late-rich', saleDate: '2026-11-01', estEquity: 400000 },
      { id: 'soon-thin', saleDate: '2026-10-01', estEquity: 80000 },
      { id: 'blank', saleDate: null, estEquity: null },
    ]
    expect(sortForeclosureList(rows, 'sale', 'asc').map((row) => row.id)).toEqual(['soon-thin', 'late-rich', 'blank'])
    expect(sortForeclosureList(rows, 'sale', 'desc').map((row) => row.id)).toEqual(['late-rich', 'soon-thin', 'blank'])
    expect(sortForeclosureList(rows, 'equity', 'desc').map((row) => row.id)).toEqual(['late-rich', 'soon-thin', 'blank'])
    expect(sortForeclosureList(rows, 'equity', 'asc').map((row) => row.id)).toEqual(['soon-thin', 'late-rich', 'blank'])
  })
})
