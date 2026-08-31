import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  formatOwnerDisplayName,
  formatOwnerState,
  formatOwnerZip,
  formatSmartSkipLastName,
  joinOwnerAddress,
  parseOwnerFamilyName,
  parseOwnerGivenName,
  parseStreetUnit,
  resolveOwnerDisplay,
  resolveSitusDisplay,
  titleCaseStreet,
} from './owner-display'

describe('parseOwnerGivenName', () => {
  it('splits BETTY J into first Betty and mi J', () => {
    expect(parseOwnerGivenName('BETTY J')).toEqual({ first: 'Betty', mi: 'J', suffix: null })
  })

  it('keeps Jr/Sr/II/III as suffix, not mi', () => {
    expect(parseOwnerGivenName('MICHAEL SR')).toEqual({ first: 'Michael', mi: null, suffix: 'Sr' })
    expect(parseOwnerGivenName('JASPER JR')).toEqual({ first: 'Jasper', mi: null, suffix: 'Jr' })
    expect(parseOwnerGivenName('JOHN II')).toEqual({ first: 'John', mi: null, suffix: 'II' })
    expect(parseOwnerGivenName('MARY III')).toEqual({ first: 'Mary', mi: null, suffix: 'III' })
  })

  it('puts a middle name in owner_1_mi and peels a trailing suffix', () => {
    expect(parseOwnerGivenName('Margie N')).toEqual({ first: 'Margie', mi: 'N', suffix: null })
    expect(parseOwnerGivenName('James Jason')).toEqual({ first: 'James', mi: 'Jason', suffix: null })
    expect(parseOwnerGivenName('CHRISTOPHER JUDE SR')).toEqual({ first: 'Christopher', mi: 'Jude', suffix: 'Sr' })
  })
})

describe('parseStreetUnit', () => {
  it('splits a swallowed unit off the street and Title Cases both cells', () => {
    expect(parseStreetUnit('303 E PARTRIDGE ST UNIT 38')).toEqual({
      street: '303 E Partridge St',
      unit: 'Unit 38',
    })
    expect(parseStreetUnit('303 E Partridge St Unit 38')).toEqual({
      street: '303 E Partridge St',
      unit: 'Unit 38',
    })
    expect(parseStreetUnit('303 E PARTRIDGE ST UNIT B')).toEqual({
      street: '303 E Partridge St',
      unit: 'Unit B',
    })
  })

  it('leaves a street without a unit intact and Title Cases it', () => {
    expect(parseStreetUnit('6125 E 127TH ST')).toEqual({
      street: '6125 E 127th St',
      unit: null,
    })
  })
})

describe('owner lock casing', () => {
  it('keeps state as 2-letter MO and zip as 5 digits', () => {
    expect(formatOwnerState('MO')).toBe('MO')
    expect(formatOwnerState('mo')).toBe('MO')
    expect(formatOwnerState('Mo')).toBe('MO')
    expect(formatOwnerZip('64030')).toBe('64030')
    expect(formatOwnerZip('64030-1234')).toBe('64030')
    expect(titleCaseStreet('303 E PARTRIDGE ST')).toBe('303 E Partridge St')
  })

  it('uses stored MI and suffix when present, otherwise parses swallowed first', () => {
    expect(resolveOwnerDisplay({
      owner_1_first: 'BETTY J',
      owner_1_last: 'MOORE',
    })).toMatchObject({ first: 'Betty', mi: 'J', last: 'Moore', suffix: null, fullName: 'Betty J Moore' })

    expect(resolveOwnerDisplay({
      owner_1_first: 'Betty',
      owner_1_mi: 'J',
      owner_1_last: 'Moore',
    })).toMatchObject({ first: 'Betty', mi: 'J', last: 'Moore', suffix: null })

    expect(formatOwnerDisplayName({
      owner_1_first: 'MICHAEL SR',
      owner_1_last: 'LOVE',
    })).toBe('Michael Love Sr')
  })

  it('peels Jr/Sr off Last Name after SmartSkip enroll into the CRM suffix cell', () => {
    expect(parseOwnerFamilyName('LOVE SR')).toEqual({ last: 'Love', suffix: 'Sr' })
    expect(resolveOwnerDisplay({
      owner_1_first: 'MICHAEL',
      owner_1_last: 'LOVE SR',
    })).toMatchObject({ first: 'Michael', mi: null, last: 'Love', suffix: 'Sr', fullName: 'Michael Love Sr' })
  })

  it('folds suffix onto Last Name for SmartSkip and never invents a Suffix chip', () => {
    expect(formatSmartSkipLastName('Love', 'Sr')).toBe('Love Sr')
    expect(formatSmartSkipLastName('LOVE SR', null)).toBe('Love Sr')
    expect(Object.keys({ lastName: formatSmartSkipLastName('Love', 'Sr') })).toEqual(['lastName'])
    const skipUpload = readFileSync('src/app/api/heirs/sync/route.ts', 'utf8')
    expect(skipUpload).toContain('first_name: prospect.owner_1_first')
    expect(skipUpload).toContain('last_name: prospect.owner_1_last')
    expect(skipUpload).not.toMatch(/suffix/i)
  })

  it('formats situs street, unit, city, MO, and zip without turning MO into Mo', () => {
    const situs = resolveSitusDisplay({
      situs_street: '303 E PARTRIDGE ST UNIT 38',
      situs_city: 'KANSAS CITY',
      situs_state: 'MO',
      situs_zip: '64133',
    })
    expect(situs).toEqual({
      street: '303 E Partridge St',
      unit: 'Unit 38',
      city: 'Kansas City',
      state: 'MO',
      zip: '64133',
    })
    expect(joinOwnerAddress(situs)).toBe('303 E Partridge St Unit 38, Kansas City, MO 64133')
    expect(joinOwnerAddress(situs)).not.toContain('Mo')
  })
})
