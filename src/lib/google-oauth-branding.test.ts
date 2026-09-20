import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GMAIL_MODIFY_SCOPE, REQUIRED_GOOGLE_OAUTH_SCOPES } from '@/lib/google-oauth-scopes'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

describe('Google OAuth public branding', () => {
  it('publishes CRM privacy disclosures required for restricted-scope verification', () => {
    const privacy = read('src/app/privacy/page.tsx')
    expect(privacy).toContain('Saving KC CRM')
    expect(privacy).toContain('gmail.readonly')
    expect(privacy).toContain('gmail.send')
    expect(privacy).toContain('calendar')
    expect(privacy).toContain('userinfo.email')
    expect(privacy).toContain('Limited Use')
    expect(privacy).toContain('Google API Services User Data Policy')
    expect(privacy).toContain('Disconnect Gmail')
    expect(privacy).toContain('support@savingkc.com')
    expect(privacy).toContain('mail.google.com')
  })

  it('publishes a crawlable CRM product homepage that links the same privacy URL', () => {
    const product = read('src/app/product/page.tsx')
    expect(product).toContain('Saving KC CRM')
    expect(product).toContain('Deal File')
    expect(product).toContain('Gmail sync')
    expect(product).toContain('Google Calendar')
    expect(product).toContain('href="/privacy"')
    expect(product).toContain('https://crm.savingkc.com/privacy')
  })

  it('covers CRM software use on the public terms page', () => {
    const terms = read('src/app/terms/page.tsx')
    expect(terms).toContain('Saving KC CRM')
    expect(terms).toContain('Connect Gmail')
    expect(terms).toContain('href="/privacy"')
  })

  it('keeps product, privacy, and terms reachable without a CRM session', () => {
    const proxy = read('src/proxy.ts')
    expect(proxy).toContain("'/product'")
    expect(proxy).toContain("'/privacy'")
    expect(proxy).toContain("'/terms'")
  })

  it('does not require unused Gmail modify for a complete grant', () => {
    expect(REQUIRED_GOOGLE_OAUTH_SCOPES).not.toContain(GMAIL_MODIFY_SCOPE)
    const authorize = read('src/app/api/auth/google/authorize/route.ts')
    const sync = read('src/lib/gmail-sync.ts')
    const send = read('src/lib/gmail-send.ts')
    expect(authorize).not.toContain(GMAIL_MODIFY_SCOPE)
    expect(sync).not.toContain('/messages/modify')
    expect(send).not.toContain('/messages/modify')
  })
})
