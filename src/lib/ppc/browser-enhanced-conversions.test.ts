import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildGoogleAdsLeadsUserData } from './browser-enhanced-conversions'

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('browser enhanced conversions for leads', () => {
  it('normalizes and hashes email and phone for GTM dataLayer use', async () => {
    await expect(buildGoogleAdsLeadsUserData({
      email: ' SELLER@Example.COM ',
      phone: '(816) 555-1212',
    })).resolves.toEqual({
      sha256_email_address: sha256Hex('seller@example.com'),
      sha256_phone_number: sha256Hex('+18165551212'),
    })
  })

  it('drops unusable identifiers instead of exposing raw contact values', async () => {
    await expect(buildGoogleAdsLeadsUserData({
      email: 'not-an-email',
      phone: '12345',
    })).resolves.toBeNull()
  })
})
