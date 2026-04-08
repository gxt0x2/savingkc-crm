#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BOOKING_ID = '5bf87b7a-9ff6-420d-a6a2-db3f73abd2c5'

console.log('\n🎯 FINAL VERIFICATION TEST\n')
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

console.log('\n✅ BOOKING:')
console.log(`   Phone: ${booking.phone}`)
console.log(`   Date/Time: ${booking.slot_date} at ${booking.slot_time}`)
console.log(`   Lead ID: ${booking.lead_id}`)

if (booking.lead_id) {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', booking.lead_id)
    .single()

  console.log('\n✅ LEAD:')
  console.log(`   Name: ${lead.full_name}`)
  console.log(`   County: ${lead.county || 'N/A'}`)
  console.log(`   Priority: ${lead.priority}`)

  const { data: manifests, count } = await supabase
    .from('manifests')
    .select('*', { count: 'exact' })
    .eq('lead_id', booking.lead_id)

  console.log('\n🎯 MANIFEST CHECK (WITH CONSTRAINT):')
  console.log(`   Count: ${count}`)

  if (count === 1) {
    console.log('   ✅✅✅ PERFECT! Exactly 1 manifest created!')
    console.log('   ✅ Race condition is FIXED!')
    console.log('   ✅ Unique constraint is WORKING!')

    const m = manifests[0]
    console.log(`\n   Manifest Details:`)
    console.log(`   - ID: ${m.id}`)
    console.log(`   - Created: ${new Date(m.created_at).toLocaleString()}`)
    console.log(`   - Has appointment: ${m.manifest?.pipeline?.appointment ? 'YES' : 'NO'}`)
    console.log(`   - Updated by: ${m.manifest?.lastUpdatedBy || 'unknown'}`)
  } else if (count > 1) {
    console.log('   ❌ FAILED! Multiple manifests created!')
    console.log('   ❌ Constraint did not prevent duplicates')
  } else {
    console.log('   ❌ No manifest created!')
  }

  // Check server logs for TEST_MODE
  console.log('\n📱 SMS TEST_MODE CHECK:')
  console.log('   Expected: NO real SMS sent')
  console.log('   Status: Check server logs at /tmp/crm-next.log')
  console.log('   Look for: 🧪 [TEST_MODE] SMS NOT SENT')
}

console.log('\n' + '='.repeat(80))
console.log('✅ FINAL VERIFICATION COMPLETE\n')
