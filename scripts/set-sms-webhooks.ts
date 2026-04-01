#!/usr/bin/env npx tsx
/**
 * One-time script: Set SMS webhooks on all 20 Saving KC numbers
 * Points them at the CRM webhook: https://crm.savingkc.com/api/twilio-sms-webhook
 *
 * Usage: npx tsx scripts/set-sms-webhooks.ts
 */

import twilio from 'twilio'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!
const SMS_WEBHOOK_URL = 'https://crm.savingkc.com/api/twilio-sms-webhook'

const SAVING_KC_NUMBERS = [
  '+18166088858', '+18166088770', '+18166088808', '+18166088552',
  '+18166088559', '+18163077835', '+18166086699', '+18164292900',
  '+18163100845', '+18166404701', '+18166086648', '+18166086999',
  '+18166088588', '+18164761344', '+18167277667', '+18164761589',
  '+18165788107', '+18162538313', '+18166408032', '+18166536616',
]

async function main() {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    console.error('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN env vars')
    process.exit(1)
  }

  const client = twilio(ACCOUNT_SID, AUTH_TOKEN)
  let ok = 0
  let fail = 0

  console.log(`Setting SMS webhook URL: ${SMS_WEBHOOK_URL}`)
  console.log(`Updating ${SAVING_KC_NUMBERS.length} numbers...\n`)

  for (const number of SAVING_KC_NUMBERS) {
    try {
      const phoneNumbers = await client.incomingPhoneNumbers.list({ phoneNumber: number })
      if (phoneNumbers.length > 0) {
        await client.incomingPhoneNumbers(phoneNumbers[0].sid).update({
          smsUrl: SMS_WEBHOOK_URL,
          smsMethod: 'POST',
        })
        console.log(`  OK  ${number}`)
        ok++
      } else {
        console.log(`  ??  ${number} — not found in account`)
        fail++
      }
    } catch (err: any) {
      console.error(`  ERR ${number} — ${err.message}`)
      fail++
    }
  }

  console.log(`\nDone: ${ok} updated, ${fail} failed`)
}

main()
