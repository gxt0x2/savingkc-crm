#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

// Load environment variables
const envFile = fs.readFileSync('/Users/ernestdodson/savingkc-crm/.env.local', 'utf8')
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=:#]+)=(.*)$/)
  if (match) {
    const key = match[1].trim()
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    process.env[key] = value
  }
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('Creating manual test booking with REAL prospect phone...\n')

  // Get a real phone from prospect_phones
  const { data: phones } = await supabase
    .from('prospect_phones')
    .select('phone, contact_name, relationship, prospects(situs_street, situs_city, county)')
    .eq('relationship', 'owner')
    .limit(1)
    .single()

  if (!phones) {
    console.error('Could not find a prospect phone')
    process.exit(1)
  }

  const testPhone = phones.phone
  const testName = phones.contact_name || 'Test Prospect'
  const prospect = phones.prospects
  const testAddress = prospect.situs_street || '123 Test St'
  const testCity = prospect.situs_city || 'Kansas City'

  console.log(`Using REAL prospect data:`)
  console.log(`  Phone: ${testPhone}`)
  console.log(`  Name: ${testName}`)
  console.log(`  Address: ${testAddress}, ${testCity}, MO`)
  console.log(`  County: ${prospect.county}`)
  console.log('')

  // Create test booking with unique time
  const slotDate = new Date()
  slotDate.setDate(slotDate.getDate() + Math.floor(Math.random() * 10) + 5) // 5-15 days out
  const slotDateStr = slotDate.toISOString().split('T')[0]
  const hour = 10 + Math.floor(Math.random() * 6) // 10 AM - 3 PM
  const slotDatetime = new Date(slotDate.setHours(hour, 0, 0, 0)).toISOString()
  const slotTime = `${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? 'PM' : 'AM'}`

  console.log('Creating booking via API...')
  const response = await fetch('http://localhost:3002/api/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      first_name: `MANUAL-TEST ${testName}`,
      phone: testPhone,
      property_address: `${testAddress}, ${testCity}, MO`,
      slot_date: slotDateStr,
      slot_time: slotTime,
      slot_datetime: slotDatetime,
      source: 'manual_enrichment_test'
    })
  })

  const result = await response.json()

  if (!result.success) {
    console.error('✗ Booking failed:', result.error)
    process.exit(1)
  }

  console.log(`✓ Booking created: ${result.booking_id}`)

  // Get lead ID
  const { data: booking } = await supabase
    .from('bookings')
    .select('lead_id')
    .eq('id', result.booking_id)
    .single()

  const leadId = booking.lead_id

  console.log(`✓ Lead ID: ${leadId}`)
  console.log('\nWaiting 60 seconds for auto-enrichment...')

  await new Promise(resolve => setTimeout(resolve, 60000))

  // Check manifest for enrichment
  console.log('\nChecking enrichment results...')

  const { data: manifest } = await supabase
    .from('manifests')
    .select('manifest')
    .eq('lead_id', leadId)
    .single()

  if (!manifest) {
    console.log('✗ No manifest found')
    process.exit(1)
  }

  const auditTrail = manifest.manifest.auditTrail || []
  const prospectEvent = auditTrail.find(e => e.action === 'prospect_enrichment_complete')
  const countyEvent = auditTrail.find(e => e.action === 'county_enrichment_complete')

  console.log('\nResults:')
  if (prospectEvent) {
    console.log(`✓ PROSPECT ENRICHMENT SUCCESS`)
    console.log(`  Matched: ${prospectEvent.metadata?.matched}`)
    console.log(`  Parcel: ${prospectEvent.metadata?.parcel_id}`)
    console.log(`  Tax debt: $${prospectEvent.metadata?.cumulative_due || 0}`)
  } else {
    console.log(`✗ No prospect enrichment`)
  }

  if (countyEvent) {
    console.log(`✓ COUNTY ENRICHMENT SUCCESS`)
    console.log(`  County: ${countyEvent.metadata?.county}`)
    console.log(`  Data source: ${countyEvent.metadata?.source}`)
  } else {
    console.log(`✗ No county enrichment`)
  }

  // Check financials
  const financials = manifest.manifest.financials || {}
  console.log('\nManifest financials:')
  console.log(`  ARV: $${financials.arv || 0} (${financials.arv_source || 'N/A'})`)
  console.log(`  Back taxes: $${financials.back_taxes || 0}`)

  const taxData = manifest.manifest.property?.taxCollector || {}
  console.log(`  Delinquent amount: $${taxData.delinquentAmount || 0}`)
  console.log(`  Years delinquent: ${taxData.yearsDelinquent || 0}`)

  const successRate = [prospectEvent, countyEvent].filter(Boolean).length / 2 * 100
  console.log(`\n${successRate === 100 ? '✓' : '⚠️'} Success rate: ${successRate}%`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
