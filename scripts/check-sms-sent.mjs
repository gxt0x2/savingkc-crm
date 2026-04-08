#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const LEAD_ID = 'cb646be4-2dc7-4cb2-99b6-66abffa4c75e'

console.log('\n📱 SMS DELIVERY VERIFICATION\n')
console.log('=' .repeat(80))

const { data } = await supabase
  .from('lead_activities')
  .select('activity_type, description, metadata, created_at')
  .eq('lead_id', LEAD_ID)
  .eq('activity_type', 'sms')
  .order('created_at', { ascending: false })

console.log(`\nFound ${data.length} SMS activities:\n`)

let realSmsSent = 0
let loggedOnly = 0

data.forEach((a, i) => {
  const time = new Date(a.created_at).toLocaleTimeString()
  const to = a.metadata?.to || 'unknown'
  const messageSid = a.metadata?.message_sid
  const trigger = a.metadata?.trigger || a.metadata?.source || 'unknown'

  console.log(`${i + 1}. [${time}] → ${to}`)
  console.log(`   Message: ${a.description.substring(0, 70)}...`)
  console.log(`   Trigger: ${trigger}`)

  if (messageSid && messageSid.startsWith('SM')) {
    console.log(`   ✅ REAL SMS SENT - Twilio SID: ${messageSid}`)
    realSmsSent++
  } else if (messageSid && messageSid.startsWith('TEST_MESSAGE_SID')) {
    console.log(`   🧪 TEST MODE - Not actually sent: ${messageSid}`)
    loggedOnly++
  } else {
    console.log(`   📝 Logged only (no SID)`)
    loggedOnly++
  }
  console.log('')
})

console.log('=' .repeat(80))
console.log('\n📊 SUMMARY:\n')
console.log(`   Real SMS sent: ${realSmsSent}`)
console.log(`   Logged only: ${loggedOnly}`)
console.log(`   Total activities: ${data.length}`)

if (realSmsSent > 0) {
  console.log('\n   ✅ VERIFIED: Real SMS was sent via Twilio!')
} else if (loggedOnly > 0 && loggedOnly === data.length) {
  console.log('\n   🧪 TEST MODE was active - no real SMS sent')
} else {
  console.log('\n   ⚠️  No SMS delivery confirmed')
}
console.log('')
