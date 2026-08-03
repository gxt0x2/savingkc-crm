import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import twilio from 'twilio'

const APPLY_CONFIRMATION = 'CONFIGURE_PRODUCTION_TWILIO_FALLBACKS'
const apply = process.argv.includes('--apply')
const confirmation = process.argv.find((argument) => argument.startsWith('--confirm='))?.split('=')[1]

function clean(value) {
  return value?.replace(/\\[rnt]/g, '').replace(/\s+/g, '').trim() || ''
}

const accountSid = clean(process.env.TWILIO_ACCOUNT_SID)
const apiKey = clean(process.env.TWILIO_API_KEY)
const apiSecret = clean(process.env.TWILIO_API_SECRET)
const authToken = clean(process.env.TWILIO_AUTH_TOKEN)
const baseUrl = clean(process.env.NEXT_PUBLIC_APP_URL) || 'https://crm.savingkc.com'
const voiceFallbackUrl = `${baseUrl.replace(/\/$/, '')}/api/twilio/fallback/voice`
const smsFallbackUrl = `${baseUrl.replace(/\/$/, '')}/api/twilio/fallback/sms`

if (!accountSid || (!authToken && !(apiKey && apiSecret))) {
  throw new Error('Twilio credentials are required for the carrier fallback audit.')
}
if (apply && confirmation !== APPLY_CONFIRMATION) {
  throw new Error(`Refusing to modify Twilio without --confirm=${APPLY_CONFIRMATION}`)
}

const source = await fs.readFile(path.join(process.cwd(), 'src/lib/twilio-numbers.ts'), 'utf8')
const registered = new Set([...source.matchAll(/value:\s*'([^']+)'/g)].map((match) => match[1]))
if (registered.size !== 21) {
  throw new Error(`Expected 21 registered phone numbers, found ${registered.size}.`)
}

const client = apiKey && apiSecret
  ? twilio(apiKey, apiSecret, { accountSid })
  : twilio(accountSid, authToken)
const live = await client.incomingPhoneNumbers.list({ limit: 100 })
const liveByNumber = new Map(live.map((record) => [record.phoneNumber, record]))
const missing = [...registered].filter((number) => !liveByNumber.has(number))
const extras = live.filter((record) => !registered.has(record.phoneNumber)).map((record) => record.phoneNumber)
if (missing.length > 0 || extras.length > 0) {
  throw new Error(`Registry mismatch. Missing: ${missing.join(', ') || 'none'}; extras: ${extras.join(', ') || 'none'}.`)
}

const changes = []
for (const number of [...registered].sort()) {
  const record = liveByNumber.get(number)
  const needsVoice = record.voiceFallbackUrl !== voiceFallbackUrl || record.voiceFallbackMethod !== 'POST'
  const needsSms = record.smsFallbackUrl !== smsFallbackUrl || record.smsFallbackMethod !== 'POST'
  if (!needsVoice && !needsSms) continue
  changes.push({ number, needsVoice, needsSms })
  if (apply) {
    await client.incomingPhoneNumbers(record.sid).update({
      voiceFallbackUrl,
      voiceFallbackMethod: 'POST',
      smsFallbackUrl,
      smsFallbackMethod: 'POST',
    })
  }
}

console.log(JSON.stringify({
  mode: apply ? 'applied' : 'dry-run',
  registered: registered.size,
  changes,
  voiceFallbackUrl,
  smsFallbackUrl,
}, null, 2))
