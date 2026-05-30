import { describe, expect, it } from 'vitest'
import {
  ppcCampaignForPageLocation,
  ppcCampaignForPhone,
  ppcCampaignNameForContext,
} from './campaigns'

describe('ppc campaign registry', () => {
  it('maps the property tax landing page to the property tax campaign', () => {
    expect(ppcCampaignForPageLocation('https://savingkc.com/ppc-tax?gclid=click')).toMatchObject({
      name: 'Search - Property Tax',
      phoneDigits: '8166086648',
      pageVariant: 'ppc_tax',
    })
  })

  it('maps phone-only calls to their campaign', () => {
    expect(ppcCampaignForPhone('+18166086648')).toMatchObject({
      name: 'Search - Property Tax',
      pagePath: '/ppc-tax',
    })
    expect(ppcCampaignForPhone('+18166088808')).toMatchObject({
      name: 'Search 2026',
      pagePath: '/ppc',
    })
  })

  it('prefers explicit UTM campaign before page fallback', () => {
    expect(ppcCampaignNameForContext({
      attribution: {
        utm_campaign: 'Custom Google Ads Campaign',
        landingUrl: 'https://savingkc.com/ppc-tax',
      },
    })).toBe('Custom Google Ads Campaign')
  })
})
