#!/usr/bin/env node
/**
 * Sprint 1 Verification Script
 * Checks manifest and lead_activities for appointment data
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('🔍 Sprint 1 Appointment Verification\n')

// 1. Check Ernest's lead for CONFIRM test
console.log('1️⃣ CONFIRM Test (Ernest +18162262552)')
const { data: ernestLead } = await supabase
  .from('leads')
  .select('id, full_name, phone')
  .eq('phone', '+18162262552')
  .single()

if (ernestLead) {
  console.log(`   Lead: ${ernestLead.full_name} (${ernestLead.id})`)

  // Check manifest
  const { data: manifest } = await supabase
    .from('manifests')
    .select('manifest')
    .eq('lead_id', ernestLead.id)
    .single()

  if (manifest?.manifest?.pipeline?.appointment) {
    const appt = manifest.manifest.pipeline.appointment
    console.log(`   ✅ Appointment in manifest:`)
    console.log(`      ID: ${appt.appointmentId}`)
    console.log(`      Type: ${appt.type}`)
    console.log(`      Scheduled: ${appt.scheduledAt}`)
    console.log(`      Status: ${appt.status}`)
    console.log(`      Confirmations: ${appt.confirmationCount}`)
    console.log(`      Ghost Risk: ${appt.ghostRiskScore}`)
    console.log(`      Last Response: ${appt.lastSellerResponse || 'Never'}`)
  } else {
    console.log(`   ❌ No appointment in manifest`)
  }

  // Check activities
  const { data: activities } = await supabase
    .from('lead_activities')
    .select('activity_type, description, created_at')
    .eq('lead_id', ernestLead.id)
    .in('activity_type', ['appointment', 'appointment_confirmed', 'sms'])
    .order('created_at', { ascending: false })
    .limit(5)

  if (activities?.length) {
    console.log(`\n   Recent activities:`)
    activities.forEach(a => {
      console.log(`   - [${a.activity_type}] ${a.description.substring(0, 80)}`)
    })
  }
} else {
  console.log(`   ❌ Lead not found for +18162262552`)
}

// 2. Check in-person appointment for April 14th
console.log('\n2️⃣ In-Person Appointment (April 14th)')
const { data: aprilAppts } = await supabase
  .from('lead_activities')
  .select('*, leads(full_name, phone)')
  .eq('activity_type', 'appointment')
  .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // Last hour
  .order('created_at', { ascending: false })
  .limit(3)

if (aprilAppts?.length) {
  aprilAppts.forEach((appt, i) => {
    console.log(`   [${i + 1}] ${appt.leads?.full_name || 'Unknown'}`)
    console.log(`       Created: ${appt.created_at}`)
    console.log(`       Description: ${appt.description?.substring(0, 100)}`)
    if (appt.metadata?.scheduled_at) {
      console.log(`       Scheduled: ${appt.metadata.scheduled_at}`)
    }
  })
} else {
  console.log(`   ❌ No recent appointments found`)
}

// 3. Telephony error - not checking, it's a separate issue

// 4. Check recent /call bookings
console.log('\n4️⃣ Recent /call Bookings')
const { data: bookings } = await supabase
  .from('bookings')
  .select('id, first_name, slot_datetime, created_at')
  .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
  .order('created_at', { ascending: false })
  .limit(3)

if (bookings?.length) {
  for (const booking of bookings) {
    console.log(`   📅 ${booking.first_name} - ${booking.slot_datetime}`)

    // Find associated lead
    const { data: lead } = await supabase
      .from('leads')
      .select('id, full_name')
      .eq('full_name', booking.first_name)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (lead) {
      // Check manifest
      const { data: manifestRow } = await supabase
        .from('manifests')
        .select('manifest')
        .eq('lead_id', lead.id)
        .single()

      if (manifestRow?.manifest?.pipeline?.appointment) {
        console.log(`      ✅ Appointment in manifest for ${lead.full_name}`)
        console.log(`         Status: ${manifestRow.manifest.pipeline.appointment.status}`)
      } else {
        console.log(`      ❌ No appointment in manifest for ${lead.full_name}`)
      }
    }
  }
} else {
  console.log(`   ❌ No recent bookings found`)
}

// Summary
console.log('\n📊 Summary')
const { data: totalAppts } = await supabase
  .from('manifests')
  .select('lead_id, manifest')
  .not('manifest->pipeline->appointment', 'is', null)

console.log(`   Total appointments in manifests: ${totalAppts?.length || 0}`)

const { data: totalActivities } = await supabase
  .from('lead_activities')
  .select('id', { count: 'exact', head: true })
  .eq('activity_type', 'appointment')

console.log(`   Total appointment activities: ${totalActivities || 0}`)

console.log('\n✅ Verification complete\n')
