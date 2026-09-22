import { expect, it } from 'vitest'
import { outreachFooter, outreachHtml } from '../providers/outreach-footer'
import { isOptOutReply } from '../inbound/content'
const unsubscribeUrl = 'https://crm.example.test/email/unsubscribe/1.opaque-token'
it('formats the signoff and the counsel opt-out without a raw token URL', () => {
  const text = outreachFooter('Saving KC Homebuyers LLC', '1705 Baltimore Ave, Kansas City, MO 64108', unsubscribeUrl)
  expect(text).toContain('Best regards,\n\nAri\nSaving KC Homebuyers\n1705 Baltimore Ave\nKansas City, MO 64108')
  expect(text).toContain('\n\n———\n\n')
  expect(text).toContain("If you'd rather I not email you again, tap Unsubscribe and I'll take you off today.")
  expect(text).not.toContain('LLC')
  expect(text).not.toContain(unsubscribeUrl)
  expect(text).not.toContain('Unsubscribe:')
})
it('drops a trailing LLC from the signature line and leaves other names alone', () => {
  for (const legal of ['Saving KC Homebuyers LLC', 'Saving KC Homebuyers, LLC', 'Saving KC Homebuyers, L.L.C.']) {
    expect(outreachFooter(legal, 'Street', unsubscribeUrl)).toContain('Ari\nSaving KC Homebuyers\nStreet')
    expect(outreachHtml('Hi', legal, 'Street', unsubscribeUrl)).toContain('Saving KC Homebuyers<br>')
    expect(outreachHtml('Hi', legal, 'Street', unsubscribeUrl)).not.toContain('LLC')
  }
  expect(outreachFooter('A & B', 'Street', unsubscribeUrl)).toContain('Ari\nA & B\nStreet')
  expect(outreachFooter('LLC Partners of KC', 'Street', unsubscribeUrl)).toContain('Ari\nLLC Partners of KC\nStreet')
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
})
it('draws a solid rule between the signature and the Unsubscribe sentence', () => {
  const html = outreachHtml('Hi Pat', 'Saving KC Homebuyers LLC', '1705 Baltimore Ave, Kansas City, MO 64108', unsubscribeUrl)
  const signature = html.indexOf('Saving KC Homebuyers<br>')
  const rule = html.indexOf('bgcolor="#333333"')
  const unsubscribe = html.indexOf('>Unsubscribe</a>')
  expect(signature).toBeGreaterThan(-1)
  expect(rule).toBeGreaterThan(signature)
  expect(unsubscribe).toBeGreaterThan(rule)
  expect(html).toContain('height="2"')
  expect(html).toContain('background-color:#333333')
  expect(html).not.toContain('<hr')
  expect(html).not.toContain('LLC')
})
it('honors remove replies without treating quoted footer text or property discussion as an opt-out', () => {
  expect(isOptOutReply('remove')).toBe(true)
  expect(isOptOutReply('REMOVE!\nOn Monday Ari wrote:\nOriginal email')).toBe(true)
  expect(isOptOutReply('Can you remove the furniture?')).toBe(false)
  expect(isOptOutReply('Yes\n> reply remove')).toBe(false)
})
