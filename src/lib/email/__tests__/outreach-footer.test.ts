import { expect, it } from 'vitest'
import { outreachFooter } from '../providers/outreach-footer'
import { isOptOutReply } from '../inbound/content'
it('formats the requested signoff and retains a direct opt-out', () => {
  expect(outreachFooter('Saving KC Homebuyers', '1705 Baltimore Ave, Kansas City, MO 64108', 'https://example.test/unsubscribe')).toBe('The very best regards\nAri\nSaving KC Homebuyers\n1705 Baltimore Ave\nKansas City, MO 64108\n\nIf you’d rather I not email you again, just reply “remove” and I’ll take you off the list today.\nUnsubscribe: https://example.test/unsubscribe')
})
it('honors remove replies without treating quoted footer text or property discussion as an opt-out', () => {
  expect(isOptOutReply('remove')).toBe(true)
  expect(isOptOutReply('REMOVE!\nOn Monday Ari wrote:\nOriginal email')).toBe(true)
  expect(isOptOutReply('Can you remove the furniture?')).toBe(false)
  expect(isOptOutReply('Yes\n> reply remove')).toBe(false)
})
