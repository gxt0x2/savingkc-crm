import { expect, it } from 'vitest'
import { outreachFooter, outreachHtml } from '../providers/outreach-footer'
import { isOptOutReply } from '../inbound/content'
it('formats the signoff and retains a direct opt-out', () => {
  expect(outreachFooter('Saving KC Homebuyers LLC', '1705 Baltimore Ave, Kansas City, MO 64108', 'https://example.test/unsubscribe')).toContain('Best regards,\n\nAri\nSaving KC Homebuyers LLC\n1705 Baltimore Ave\nKansas City, MO 64108')
})
it('escapes HTML content and supplies a working unsubscribe link', () => {
  const html = outreachHtml('<script>bad</script>', 'A & B', 'Street', 'https://example.test/unsubscribe')
  expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;')
  expect(html).toContain('A &amp; B')
  expect(html).toContain('<strong>Ari</strong>')
  expect(html).toContain('href="https://example.test/unsubscribe"')
  expect(html).toContain('<hr ')
})
it('honors remove replies without treating quoted footer text or property discussion as an opt-out', () => {
  expect(isOptOutReply('remove')).toBe(true)
  expect(isOptOutReply('REMOVE!\nOn Monday Ari wrote:\nOriginal email')).toBe(true)
  expect(isOptOutReply('Can you remove the furniture?')).toBe(false)
  expect(isOptOutReply('Yes\n> reply remove')).toBe(false)
})
