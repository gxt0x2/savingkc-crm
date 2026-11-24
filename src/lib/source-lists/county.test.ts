import { describe, expect, it } from 'vitest'
import {
  countyForCity,
  parcelMatchCounty,
  resolveCodeViolationPlace,
} from './county'

describe('code violation county placement', () => {
  it('places Kansas City, Missouri from the zip, not the city name', () => {
    expect(resolveCodeViolationPlace({
      city: 'Kansas City',
      state: 'MO',
      zip_code: '64118',
    })).toEqual({ county: 'clay', outOfArea: false })
    expect(resolveCodeViolationPlace({
      city: 'Kansas City',
      state: 'MO',
      zip: '64155',
    })).toEqual({ county: 'clay', outOfArea: false })
    expect(resolveCodeViolationPlace({
      city: 'Kansas City',
      state: 'MO',
      incident_address: '10 Main St, Kansas City, MO 64163',
    })).toEqual({ county: 'platte', outOfArea: false })
    expect(resolveCodeViolationPlace({
      city: 'Kansas City',
      state: 'MO',
      zip_code: '64127',
    })).toEqual({ county: 'jackson', outOfArea: false })
  })

  it('reads a parcel-match key before the city', () => {
    expect(parcelMatchCounty({ _clay_parcel_match: '{"pin":"1"}', city: 'Kansas City' })).toBe('clay')
    expect(resolveCodeViolationPlace({
      _platte_parcel_match: 'yes',
      city: 'Kansas City',
      zip_code: '64127',
    })).toEqual({ county: 'platte', outOfArea: false })
  })

  it('places other service-area cities and keeps Cass out', () => {
    expect(countyForCity('Independence', 'MO')).toEqual({ county: 'jackson', state: 'MO' })
    expect(countyForCity('Overland Park', null)).toEqual({ county: 'johnson', state: 'KS' })
    expect(countyForCity('Kansas City', 'KS')).toEqual({ county: 'wyandotte', state: 'KS' })
    expect(countyForCity('Kansas City', 'MO')).toBeNull()
    expect(resolveCodeViolationPlace({ city: 'Belton', state: 'MO', zip: '64012' })).toEqual({
      county: null,
      outOfArea: true,
    })
    expect(resolveCodeViolationPlace({ county: 'Cass', city: 'Raymore', state: 'MO' })).toEqual({
      county: null,
      outOfArea: true,
    })
    expect(resolveCodeViolationPlace({ county: 'Johnson', state: 'KS' })).toEqual({
      county: 'johnson',
      outOfArea: false,
    })
    expect(resolveCodeViolationPlace({ county: 'Johnson', state: 'MO' })).toEqual({
      county: null,
      outOfArea: true,
    })
    expect(resolveCodeViolationPlace({ county: 'Johnson' })).toEqual({
      county: null,
      outOfArea: false,
    })
  })

  it('does not assign a split zip by itself', () => {
    expect(resolveCodeViolationPlace({
      city: 'Kansas City',
      state: 'MO',
      zip_code: '64063',
    })).toEqual({ county: null, outOfArea: false })
    expect(resolveCodeViolationPlace({
      city: "Lee's Summit",
      state: 'MO',
      zip_code: '64063',
    })).toEqual({ county: 'jackson', outOfArea: false })
  })
})
