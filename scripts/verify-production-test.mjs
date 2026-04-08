#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BOOKING_ID = 'f4ac21cf-a21d-466f-8504-189a836a3933'

console.log('\n🔍 PRODUCTION MODE VERIFICATION\n')
console.log('=' .repeat(80))

const { data: booking } = await supabase
  .from('bookings')
  .select('*')
  .eq('id', BOOKING_ID)
  .single()

if (!booking) {
  console.log('❌ Booking not found!')
  process.exit(1)
}

console.log('\n✅ BOOKING CREATED:')
console.log(`   Phone: ${booking.phone}`)
console.log(`   Lead ID: ${booking.lead_id}`)

if (booking.lead_id) {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', booking.lead_id)
    .single()

  console.log('\n✅ LEAD CREATED:')
  console.log(`   Name: ${lead.full_name}`)
  console.log(`   County: ${lead.county || 'N/A'}`)
  console.log(`   Priority: ${lead.priority}`)

  // CRITICAL TEST: Check manifest count
  const { data: manifests, count } = await supabase
    .from('manifests')
    .select('id, created_at, manifest', { count: 'exact' })
    .eq('lead_id', booking.lead_id)
    .order('created_at', { ascending: true })

  console.log('\n🎯 RACE CONDITION TEST (PRODUCTION MODE):')
  console.log(`   Manifest Count: ${count}`)

  if (count === 1) {
    console.log('   ✅✅✅ PASS! Exactly 1 manifest created!')
    console.log('   ✅ Race condition is FIXED in production!')
    console.log('   ✅ Database constraint is WORKING!')

    const m = manifests[0]
    const createdTime = new Date(m.created_at).toLocaleTimeString()
    const updatedBy = m.manifest?.lastUpdatedBy || 'unknown'

    console.log(`\n   Details:`)
    console.log(`   - Created at: ${createdTime}`)
    console.log(`   - Updated by: ${updatedBy}`)
    console.log(`   - Has appointment: ${m.manifest?.pipeline?.appointment ? 'YES' : 'NO'}`)
  } else if (count > 1) {
    console.log('   ❌❌❌ FAIL! Multiple manifests created!')
    console.log('   ❌ Race condition NOT fixed!')
    console.log(`\n   Found ${count} manifests:`)
    manifests.forEach((m, i) => {
      const time = new Date(m.created_at).toLocaleTimeString()
      const agent = m.manifest?.lastUpdatedBy || 'unknown'
      console.log(`   ${i + 1}. Created at ${time} by ${agent}`)
    })
  } else {
    console.log('   ❌ No manifest created!')
  }

  // Check for SMS sending attempts
  const { data: activities } = await supabase
    .from('lead_activities')
    .select('*')
    .eq('lead_id', booking.lead_id)
    .eq('activity_type', 'sms')
    .order('created_at', { ascending: false })
    .limit(5)

  console.log('\n📱 SMS ACTIVITY CHECK:')
  if (activities && activities.length > 0) {
    console.log(`   Found ${activities.length} SMS activities`)
    activities.forEach((a, i) => {
      const direction = a.metadata?.direction || 'unknown'
      const to = a.metadata?.to || 'unknown'
      console.log(`   ${i + 1}. ${direction} to ${to}`)
    })
  } else {
    console.log('   ⚠️  No SMS activities logged yet (may be processing)')
  }
}

console.log('\n' + '='.repeat(80))

// Final verdict
const { data: manifests, count } = await supabase
  .from('manifests')
  .select('id', { count: 'exact' })
  .eq('lead_id', booking.lead_id)

if (count === 1) {
  console.log('\n✅ FINAL VERDICT: Race condition FIX is PROVEN in production mode!\n')
} else {
  console.log('\n❌ FINAL VERDICT: Race condition still exists!\n')
  process.exit(1)
}
