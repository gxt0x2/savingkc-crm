import { describe, expect, it } from 'vitest'
import {
  buildFormLeadCallbackIntro,
  firstNameFromFullName,
  streetFromAddress,
} from './lead-form-callback'

describe('lead-form-callback', () => {
  it('uses the first name in the agent intro', () => {
    expect(firstNameFromFullName('Rob Seller')).toBe('Rob')
    expect(firstNameFromFullName('')).toBe('A seller')
  })

  it('uses the street portion of the address', () => {
    expect(streetFromAddress('123 Main St, Kansas City, MO 64131')).toBe('123 Main St')
  })

  it('builds the form-specific callback intro without saying Google Ads', () => {
    expect(buildFormLeadCallbackIntro({
      fullName: 'Rob Seller',
      address: '123 Main St, Kansas City, MO 64131',
      city: 'Kansas City',
    })).toBe('Rob is looking to sell their place on 123 Main St in Kansas City. Calling them now.')
  })
})
