import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  extractIntentQuote,
  hasExplicitSellingIntent,
  isCompanySellAutoText,
} from './selling-intent'

const SELL_AUTO_TEXT = "Thanks for calling Saving KC Homebuyers. Were you looking to sell a property? Reply YES and we'll call you right back."
const SELL_AUTO_TEXT_AGAIN = "Hi, this is Casey with Saving KC. I see you called again — are you trying to reach us about selling a property? Reply YES or call us back anytime."
const SELL_AUTO_TEXT_THIRD = "Ernest here from Saving KC. Looks like we keep missing each other! Reply YES or call back and we'll get you taken care of."
const SELL_AUTO_TEXT_FOURTH = "We're here! Reply YES or call Ernest at Saving KC anytime."
const APPOINTMENT_YES = "Hey Pat, it's Casey with Saving KC Homebuyers. I have us locked in for Tuesday at 2. Reply YES to confirm. My direct number is (816) 226-2552 if anything comes up before then."

const REALTORS_SURVEY = 'Missouri REALTORS: Your opinion matters! Share your views and help us to better represent you by taking a short survey and enter to win 1 of 5 $100 Visa gift cards. Responses are confidential: https://www.opinion-counts.com/jfe/form/SV_3e1sDtfYApdGRXE \r\nText STOP to quit'

describe('company sell auto-text', () => {
  it('recognizes the production missed-call Reply YES bodies and not an appointment confirm', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/missed-call-messaging.ts'), 'utf8')
    expect(source).toContain("Were you looking to sell a property? Reply YES and we'll call you right back.")
    expect(source).toContain('are you trying to reach us about selling a property? Reply YES or call us back anytime.')
    expect(source).toContain("Looks like we keep missing each other! Reply YES or call back and we'll get you taken care of.")
    expect(source).toContain('Reply YES or call ${agentName} at Saving KC anytime.')

    expect(isCompanySellAutoText(SELL_AUTO_TEXT)).toBe(true)
    expect(isCompanySellAutoText(SELL_AUTO_TEXT_AGAIN)).toBe(true)
    expect(isCompanySellAutoText(SELL_AUTO_TEXT_THIRD)).toBe(true)
    expect(isCompanySellAutoText(SELL_AUTO_TEXT_FOURTH)).toBe(true)
    expect(isCompanySellAutoText(APPOINTMENT_YES)).toBe(false)
    expect(isCompanySellAutoText(null)).toBe(false)
  })
})

describe('hasExplicitSellingIntent', () => {
  it.each([
    'I am interested in selling',
    'I want to sell',
    'I need to sell',
    "I'd like to sell",
    'I would like to sell my house',
    'looking to sell',
    'ready to sell',
    'I want an offer',
    'I want an offer on my property',
    'make me an offer',
    'what would you offer',
    'can I get a cash offer',
    'for sale',
    'for sale soon',
    'I have a house to sell',
    'I got another one to sell',
    'My asking price is $420,000 and I want to sell',
  ])('accepts explicit wording: %s', (message) => {
    const result = hasExplicitSellingIntent(message)
    expect(result.intent).toBe(true)
    if (result.intent) expect(result.quote).toContain(message.slice(0, 12))
  })

  it('accepts YES only as a reply to the sell auto-text', () => {
    expect(hasExplicitSellingIntent('YES', { priorOutbound: SELL_AUTO_TEXT })).toMatchObject({
      intent: true,
      reason: 'reply_yes_to_sell_auto_text',
      quote: 'YES',
    })
    expect(hasExplicitSellingIntent('YES!', { priorOutbound: SELL_AUTO_TEXT_AGAIN }).intent).toBe(true)
    expect(hasExplicitSellingIntent('YES PLEASE', { priorOutbound: SELL_AUTO_TEXT_THIRD }).intent).toBe(true)
    expect(hasExplicitSellingIntent('yes', { priorOutbound: SELL_AUTO_TEXT_FOURTH }).intent).toBe(true)
    expect(hasExplicitSellingIntent('YES').intent).toBe(false)
    expect(hasExplicitSellingIntent('YES', { priorOutbound: null })).toMatchObject({ intent: false, reason: 'yes_without_sell_auto_text' })
    expect(hasExplicitSellingIntent('YES', { priorOutbound: 'Just checking in' }).intent).toBe(false)
    expect(hasExplicitSellingIntent('YES', { priorOutbound: APPOINTMENT_YES }).intent).toBe(false)
    expect(hasExplicitSellingIntent('Y', { priorOutbound: SELL_AUTO_TEXT }).intent).toBe(false)
    expect(hasExplicitSellingIntent('Y').intent).toBe(false)
  })

  it.each([
    'Please text me.',
    "I'll call you later",
    'Is this Saving KC?',
    'Hey do you guys deal with foreclosure properties only in Kansas City?',
    'I will definitely give you a call if anything changes about the house',
    'https://youtube.com/shorts/abc123',
    'https://youtu.be/dQw4w9WgXcQ',
    "No, we're staying in.",
    "I don't have a house.",
    'STOP',
    'wrong number',
    'yes that\'s my name',
    '',
    '👍',
    '$230,000',
    'I am not interested in selling',
    "I don't want to sell",
  ])('rejects non-intent: %s', (message) => {
    expect(hasExplicitSellingIntent(message).intent).toBe(false)
  })

  it('rejects industry senders even when the text says for sale', () => {
    expect(hasExplicitSellingIntent(REALTORS_SURVEY).intent).toBe(false)
    expect(hasExplicitSellingIntent('Heartland MLS: Your passcode is 482913. Do not share this code.').intent).toBe(false)
    expect(hasExplicitSellingIntent('KCRAR: Board ballot is open. Please vote by Friday.').intent).toBe(false)
    expect(hasExplicitSellingIntent('Platinum Realty: New listing for sale at 123 Main. Agent only.').intent).toBe(false)
    expect(hasExplicitSellingIntent('Your Heartland MLS passcode is 1044. A house is for sale nearby.').intent).toBe(false)
  })

  it('does not treat the company auto-text itself as the seller speaking', () => {
    expect(hasExplicitSellingIntent(SELL_AUTO_TEXT).intent).toBe(false)
  })

  it('quotes the seller words for the activity log', () => {
    expect(extractIntentQuote('  For sale soon retired soo n  ')).toBe('For sale soon retired soo n')
    expect(extractIntentQuote('Please text me.')).toBe('')
    expect(extractIntentQuote('YES', { priorOutbound: SELL_AUTO_TEXT })).toBe('YES')
    expect(extractIntentQuote('YES')).toBe('')
  })
})

describe('11/11 prospect review phrases', () => {
  const keptOrExplicit = [
    ['DONALD BENNETT', 'For sale soon retired soo n'],
    ['DAVID WALLICK', 'I got another one to sell in Overland Park'],
  ] as const

  const notAutomatedIntent = [
    ['SAFIYA H MOHAMED', "She said she would like to get at least what she's put into it, 500k. If she doesn't get a number that convinces her to move she is willing to wait it out another year or two and get more then."],
    ['WALTER NAJERA', '$230,000'],
    ['ROBERT W LICHTSINN', 'Please text me.'],
    ['MICHELLE FROST', "I'll call you later"],
    ['SMS Lead (253) 322-5484', 'Hey do you guys deal with foreclosure properties only in Kansas City?'],
    ['SMS Lead (786) 723-8349', 'Is this Saving KC?'],
    ['Jesse N Mckenzie', 'I will definitely give you a call if anything changes about the house'],
    ['ANGELA ESPINAL', "No, we're staying in."],
    ['MANUEL GONZALES', "I don't have a house."],
    ['MARTHA WEISS', "That one would belong to my brother. I have no way of reaching him, so don't bother asking."],
    ['Caller (800) 463-3339', 'Track your shipment on FedEx.com'],
    ['Caller (572) 213-1815', 'jsalem@vanguard-rei-solutions.com'],
  ] as const

  it.each(keptOrExplicit)('%s phrase is explicit selling intent', (_name, phrase) => {
    const result = hasExplicitSellingIntent(phrase)
    expect(result.intent).toBe(true)
    if (result.intent) expect(extractIntentQuote(phrase)).toBe(result.quote)
  })

  it.each(notAutomatedIntent)('%s phrase stays a prospect for the automated gate', (_name, phrase) => {
    expect(hasExplicitSellingIntent(phrase).intent).toBe(false)
    expect(extractIntentQuote(phrase)).toBe('')
  })
})
