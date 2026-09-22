import { expect, it } from 'vitest'
import { outreachFooter, outreachHtml } from '../providers/outreach-footer'
import { isOptOutReply } from '../inbound/content'
const unsubscribeUrl = 'https://crm.example.test/email/unsubscribe/1.opaque-token'
it('formats the signoff and the counsel opt-out without a raw token URL', () => {
  const text = outreachFooter('Saving KC Homebuyers LLC', '1705 Baltimore Ave, Kansas City, MO 64108', unsubscribeUrl)
  expect(text).toContain('Best regards,\n\nAri\nSaving KC Homebuyers LLC\n1705 Baltimore Ave\nKansas City, MO 64108')
  expect(text).toContain("If you'd rather I not email you again, tap Unsubscribe and I'll take you off today.")
  expect(text).not.toContain(unsubscribeUrl)
  expect(text).not.toContain('Unsubscribe:')
})
it('escapes HTML content and links the word Unsubscribe', () => {
  const html = outreachHtml('<script>bad</script>', 'A & B', 'Street', 'https://example.test/unsubscribe')
  expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;')
  expect(html).toContain('A &amp; B')
  expect(html).toContain('<strong>Ari</strong>')
  expect(html).toContain('href="https://example.test/unsubscribe"')
  expect(html).toContain('If you&#39;d rather I not email you again, tap ')
  expect(html).toContain('>Unsubscribe</a>')
  expect(html).toContain(' and I&#39;ll take you off today.')
  expect(html).not.toContain('>remove</a>')
  expect(html.replace('href="https://example.test/unsubscribe"', 'href=""')).not.toContain('https://example.test/unsubscribe')
  expect(html).toContain('<hr ')
})
it('honors remove replies without treating quoted footer text or property discussion as an opt-out', () => {
  expect(isOptOutReply('remove')).toBe(true)
  expect(isOptOutReply('REMOVE!\nOn Monday Ari wrote:\nOriginal email')).toBe(true)
  expect(isOptOutReply('Can you remove the furniture?')).toBe(false)
  expect(isOptOutReply('Yes\n> reply remove')).toBe(false)
})
