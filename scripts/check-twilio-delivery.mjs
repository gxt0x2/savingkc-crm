#!/usr/bin/env node
import { readFileSync } from 'fs'

const envFile = readFileSync('.env.local', 'utf8')
const env = {}
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/)
  if (match) env[match[1]] = match[2]
})

const ACCOUNT_SID = env.TWILIO_ACCOUNT_SID
const AUTH_TOKEN = env.TWILIO_AUTH_TOKEN

const ernestSID = 'SM422a4e6e91228e57b0c1577c83172833'
const caseySID = 'SMe22ba501dfbf9965a41cb841ed4da175'

console.log('\n🔍 Checking Twilio delivery status for recent alerts...\n')

async function checkMessage(sid, name) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/${sid}.json`

  const response = await fetch(url, {
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')
    }
  })

  if (!response.ok) {
    console.error(`❌ Failed to fetch ${name}: ${response.status}`)
    return
  }

  const msg = await response.json()

  console.log(`${name} (${msg.to}):`)
  console.log(`  Status: ${msg.status}`)
  console.log(`  Created: ${msg.date_created}`)
  console.log(`  Sent: ${msg.date_sent || 'Not sent yet'}`)
  console.log(`  Updated: ${msg.date_updated}`)

  if (msg.error_code) {
    console.log(`  ❌ Error Code: ${msg.error_code}`)
    console.log(`  Error Message: ${msg.error_message}`)
  }

  console.log(`  Price: ${msg.price || 'Not charged yet'}`)
  console.log(`  From: ${msg.from}`)
  console.log(`  Body: ${msg.body.slice(0, 80)}...\n`)

  // Explain status
  if (msg.status === 'queued') {
    console.log('  ⏳ Still in Twilio queue (not sent to carrier yet)\n')
  } else if (msg.status === 'sent') {
    console.log('  📤 Sent to carrier (waiting for delivery confirmation)\n')
  } else if (msg.status === 'delivered') {
    console.log('  ✅ Delivered to phone (carrier confirmed)\n')
  } else if (msg.status === 'failed' || msg.status === 'undelivered') {
    console.log('  ❌ FAILED - carrier rejected or could not deliver\n')
  }
}

await checkMessage(ernestSID, 'Ernest Alert')
await checkMessage(caseySID, 'Casey Alert')

console.log('─'.repeat(80))
console.log('\nTwilio Status Meanings:')
console.log('  queued      → Accepted by Twilio, not sent to carrier yet')
console.log('  sent        → Sent to carrier, waiting for delivery confirmation')
console.log('  delivered   → Carrier confirmed delivery to phone')
console.log('  failed      → Carrier rejected or could not deliver')
console.log('  undelivered → Could not be delivered (invalid number, blocked, etc.)')
console.log('')
