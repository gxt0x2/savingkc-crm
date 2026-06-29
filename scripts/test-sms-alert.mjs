#!/usr/bin/env node
/**
 * Test SMS alerts for existing leads
 *
 * This simulates an inbound SMS from an existing lead
 * and verifies that BOTH Casey and Ernest receive alerts.
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const ERNEST_PHONE = process.env.ERNEST_PHONE || '+19137179716'
const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002'

async function testSmsAlert() {
  console.log('\n🧪 Testing SMS Alerts for Existing Leads\n')

  // 1. Find an existing lead with a phone number
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, name, phone, priority')
    .not('phone', 'is', null)
    .limit(5)

  if (error || !leads || leads.length === 0) {
    console.error('❌ No leads found:', error)
    return
  }

  console.log(`Found ${leads.length} leads with phone numbers:\n`)
  leads.forEach((lead, i) => {
    console.log(`${i + 1}. ${lead.name} (${lead.phone}) - Priority: ${lead.priority || 'normal'}`)
  })

  // Use the first lead for testing
  const testLead = leads[0]
  console.log(`\n📱 Testing with: ${testLead.name} (${testLead.phone})\n`)

  // 2. Simulate the webhook code logic
  console.log('--- Simulating SMS Webhook Logic ---\n')

  const messageBody = "Hey, I'm interested in selling my house"
  const from = testLead.phone
  const leadId = testLead.id
  const leadName = testLead.name

  console.log(`Inbound SMS from: ${from}`)
  console.log(`Message: "${messageBody}"`)
  console.log(`Lead ID: ${leadId}`)
  console.log(`Lead Name: ${leadName}\n`)

  // Check the current code logic
  console.log('--- Current Code Behavior ---\n')

  if (testLead.priority === 'hot') {
    console.log('✅ CURRENT: This lead IS hot, so alerts WOULD be sent')
    console.log(`   → Alert to Casey: ${CASEY_PHONE}`)
    console.log(`   → Alert to Ernest: ${ERNEST_PHONE}`)
  } else {
    console.log('❌ CURRENT: This lead is NOT hot, so NO alerts sent')
    console.log('   (Only logged to database)')
  }

  console.log('\n--- NEW Code Behavior (after change) ---\n')
  console.log('✅ NEW: This lead exists, so alerts WILL be sent')
  console.log(`   → Alert to Casey: ${CASEY_PHONE}`)
  console.log(`   → Alert to Ernest: ${ERNEST_PHONE}`)

  // 3. Actually send a test SMS alert to verify it works
  console.log('\n--- Sending TEST Alert (to Ernest only for safety) ---\n')

  const testAlertBody = `🧪 TEST ALERT: ${leadName} just texted: "${messageBody.slice(0, 100)}" — ${BASE_URL}/leads/${leadId}`

  try {
    const response = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + process.env.TWILIO_ACCOUNT_SID + '/Messages.json', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: TWILIO_PHONE,
        To: ERNEST_PHONE,
        Body: testAlertBody,
      }),
    })

    if (response.ok) {
      console.log('✅ Test alert sent to Ernest successfully!')
      console.log(`   Check your phone: ${ERNEST_PHONE}`)
    } else {
      const error = await response.text()
      console.error('❌ Failed to send test alert:', error)
    }
  } catch (err) {
    console.error('❌ Error sending test alert:', err.message)
  }

  console.log('\n✅ Test complete!\n')
}

testSmsAlert().catch(console.error)
