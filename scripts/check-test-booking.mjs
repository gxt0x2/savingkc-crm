#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BOOKING_ID = '5e32dcf8-df4f-49f1-b78c-b9bd29a48a30'

console.log('\n📋 CHECKING TEST BOOKING RESULTS\n')
console.log('=' .repeat(80))

// 1. Get booking
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
console.log(`   ID: ${booking.id}`)
console.log(`   Name: ${booking.first_name}`)
console.log(`   Phone: ${booking.phone}`)
console.log(`   Address: ${booking.property_address}`)
console.log(`   Date/Time: ${booking.slot_date} at ${booking.slot_time}`)
console.log(`   Lead ID: ${booking.lead_id || 'N/A'}`)

// 2. Get lead
if (booking.lead_id) {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', booking.lead_id)
    .single()

  if (lead) {
    console.log('\n✅ LEAD CREATED:')
    console.log(`   ID: ${lead.id}`)
    console.log(`   Name: ${lead.full_name}`)
    console.log(`   Phone: ${lead.phone}`)
    console.log(`   Address: ${lead.property_address}`)
    console.log(`   City: ${lead.city || 'N/A'}`)
    console.log(`   State: ${lead.state || 'N/A'}`)
    console.log(`   County: ${lead.county || 'N/A'}`)
    console.log(`   Station: ${lead.station}`)
    console.log(`   Priority: ${lead.priority}`)
    console.log(`   Source: ${lead.source}`)
  }

  // 3. Get manifests for this lead
  const { data: manifests, count } = await supabase
    .from('manifests')
    .select('*', { count: 'exact' })
    .eq('lead_id', booking.lead_id)

  console.log('\n📊 MANIFESTS FOR THIS LEAD:')
  console.log(`   Count: ${count}`)

  if (count > 1) {
    console.log('   ⚠️  WARNING: Multiple manifests detected! (Race condition)')
    manifests.forEach((m, i) => {
      const createdAt = new Date(m.created_at).toLocaleTimeString()
      const agent = m.manifest?.lastUpdatedBy || m.manifest?.auditTrail?.[0]?.agent || 'unknown'
      console.log(`   ${i + 1}. Created at ${createdAt} by ${agent}`)
    })
  } else if (count === 1) {
    console.log('   ✅ Exactly 1 manifest created (race condition FIXED!)')
    const m = manifests[0]
    console.log(`   Manifest ID: ${m.id}`)
    console.log(`   Station: ${m.current_station}`)
    console.log(`   Priority: ${m.priority}`)
    console.log(`   Has appointment: ${m.manifest?.pipeline?.appointment ? 'YES' : 'NO'}`)
    if (m.manifest?.pipeline?.appointment) {
      const appt = m.manifest.pipeline.appointment
      console.log(`   Appointment type: ${appt.type}`)
      console.log(`   Scheduled: ${appt.scheduledAt}`)
      console.log(`   Status: ${appt.status}`)
    }
  } else {
    console.log('   ❌ No manifest created!')
  }

  // 4. Get lead activities
  const { data: activities, count: activityCount } = await supabase
    .from('lead_activities')
    .select('*', { count: 'exact' })
    .eq('lead_id', booking.lead_id)
    .order('created_at', { ascending: false })

  console.log('\n📝 LEAD ACTIVITIES:')
  console.log(`   Count: ${activityCount}`)

  if (activities && activities.length > 0) {
    activities.forEach((a, i) => {
      console.log(`   ${i + 1}. [${a.activity_type}] ${a.description.substring(0, 60)}...`)
    })
  }
}

console.log('\n' + '='.repeat(80))
console.log('\n✅ TEST COMPLETE\n')
