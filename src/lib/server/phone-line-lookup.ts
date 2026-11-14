import twilio from 'twilio'
import { parseTwilioLookupPayload, type ParsedLookup } from '@/lib/server/phone-line-check'

const LOOKUP_TIMEOUT_MS = 8_000
const LOOKUP_FIELDS = 'line_status,line_type_intelligence'

function cleanTwilioEnv(name: string): string {
  return process.env[name]
    ?.replace(/\\[rnt]/g, '')
    .replace(/\s+/g, '')
    .trim() ?? ''
}

type LookupClient = {
  lookups: {
    v2: {
      phoneNumbers: (phone: string) => {
        fetch: (args: { fields: string }) => Promise<unknown>
      }
    }
  }
}

export function createTwilioLookupClient(): LookupClient {
  const accountSid = cleanTwilioEnv('TWILIO_ACCOUNT_SID')
  const apiKey = cleanTwilioEnv('TWILIO_API_KEY')
  const apiSecret = cleanTwilioEnv('TWILIO_API_SECRET')
  const authToken = cleanTwilioEnv('TWILIO_AUTH_TOKEN')
  if (!accountSid) {
    throw new Error('Twilio Lookup is not configured: missing TWILIO_ACCOUNT_SID')
  }
  if (apiKey && apiSecret) {
    return twilio(apiKey, apiSecret, { accountSid, timeout: LOOKUP_TIMEOUT_MS })
  }
  if (authToken) {
    return twilio(accountSid, authToken, { timeout: LOOKUP_TIMEOUT_MS })
  }
  throw new Error('Twilio Lookup is not configured: missing TWILIO_API_KEY/TWILIO_API_SECRET or TWILIO_AUTH_TOKEN')
}

export async function lookupPhoneLine(client: LookupClient, phoneE164: string): Promise<ParsedLookup> {
  const payload = await client.lookups.v2.phoneNumbers(phoneE164).fetch({ fields: LOOKUP_FIELDS })
  return parseTwilioLookupPayload(payload)
}
