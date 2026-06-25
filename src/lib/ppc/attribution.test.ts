import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureAttribution, getAttribution } from './attribution'

function storageMock() {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
    clear: vi.fn(() => {
      values.clear()
    }),
  }
}

function stubBrowser(search: string, cookie = '') {
  const sessionStorage = storageMock()
  vi.stubGlobal('window', {
    location: {
      href: `https://savingkc.com/ppc${search}`,
      search,
      hostname: 'savingkc.com',
      protocol: 'https:',
    },
  })
  vi.stubGlobal('document', {
    referrer: 'https://www.google.com/',
    cookie,
  })
  vi.stubGlobal('sessionStorage', sessionStorage)
  return sessionStorage
}

describe('ppc attribution persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('captures click ids into sessionStorage and a 90-day first-party cookie', () => {
    const sessionStorage = stubBrowser('?gbraid=apple-click&utm_campaign=Search%202026')

    const attribution = captureAttribution()

    expect(attribution).toMatchObject({
      gbraid: 'apple-click',
      utm_campaign: 'Search 2026',
      landingUrl: 'https://savingkc.com/ppc?gbraid=apple-click&utm_campaign=Search%202026',
      referrer: 'https://www.google.com/',
    })
    expect(sessionStorage.setItem).toHaveBeenCalledWith('skc.ppc.attribution.v1', expect.any(String))
    expect(document.cookie).toContain('skc_ppc_attribution=')
    expect(document.cookie).toContain('Max-Age=7776000')
    expect(document.cookie).toContain('Domain=.savingkc.com')
    expect(document.cookie).toContain('Secure')
  })

  it('rehydrates attribution from the cookie when sessionStorage is gone', () => {
    const payload = encodeURIComponent(JSON.stringify({
      landingUrl: 'https://savingkc.com/ppc?gclid=stored-click',
      gclid: 'stored-click',
      utm_campaign: 'Search 2026',
    }))
    stubBrowser('', `skc_ppc_attribution=${payload}; Path=/`)

    expect(getAttribution()).toMatchObject({
      gclid: 'stored-click',
      utm_campaign: 'Search 2026',
    })
  })

  it('replaces stored attribution when a new paid click arrives', () => {
    const sessionStorage = stubBrowser('?gclid=tax-click&utm_campaign=Search%20-%20Property%20Tax')
    sessionStorage.setItem('skc.ppc.attribution.v1', JSON.stringify({
      landingUrl: 'https://savingkc.com/ppc?gclid=old-click',
      gclid: 'old-click',
      utm_campaign: 'Search 2026',
    }))

    expect(captureAttribution()).toMatchObject({
      gclid: 'tax-click',
      utm_campaign: 'Search - Property Tax',
      landingUrl: 'https://savingkc.com/ppc?gclid=tax-click&utm_campaign=Search%20-%20Property%20Tax',
    })
  })

  it('captures OpenAI Ads oppref from the URL and cookie fallback', () => {
    const direct = stubBrowser('?oppref=openai-click-123')

    expect(captureAttribution()).toMatchObject({
      oppref: 'openai-click-123',
      landingUrl: 'https://savingkc.com/ppc?oppref=openai-click-123',
    })
    expect(direct.setItem).toHaveBeenCalledWith('skc.ppc.attribution.v1', expect.stringContaining('openai-click-123'))

    vi.unstubAllGlobals()
    stubBrowser('', '__oppref=openai-cookie-456; Path=/')

    expect(captureAttribution()).toMatchObject({
      oppref: 'openai-cookie-456',
    })
  })

  it('captures the first-party OpenAI click id from query and cookie fallback', () => {
    const direct = stubBrowser('?utm_source=chatgpt&skc_openai_click_id=skc_openai_123')

    expect(captureAttribution()).toMatchObject({
      utm_source: 'chatgpt',
      skc_openai_click_id: 'skc_openai_123',
      landingUrl: 'https://savingkc.com/ppc?utm_source=chatgpt&skc_openai_click_id=skc_openai_123',
    })
    expect(direct.setItem).toHaveBeenCalledWith('skc.ppc.attribution.v1', expect.stringContaining('skc_openai_123'))

    vi.unstubAllGlobals()
    stubBrowser('', '__skc_openai_click_id=skc_openai_cookie_456; Path=/')

    expect(captureAttribution()).toMatchObject({
      skc_openai_click_id: 'skc_openai_cookie_456',
    })
  })
})
