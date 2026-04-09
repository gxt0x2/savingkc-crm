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
  console.log('=== BROAD ENRICHMENT TEST — Multiple Counties & Addresses ===\n')

  // Get 5 different prospects from different counties
  const { data: prospects } = await supabase
    .from('prospect_phones')
    .select('phone, contact_name, relationship, prospects(id, situs_street, situs_city, situs_state, county)')
    .eq('relationship', 'owner')
    .limit(100)

  if (!prospects || prospects.length === 0) {
    console.error('No prospects found')
    process.exit(1)
  }

  // Pick one from each county
  const countySeen = new Set()
  const testCases = []
  for (const p of prospects) {
    const county = p.prospects?.county
    if (!county || countySeen.has(county)) continue
    countySeen.add(county)
    testCases.push({
      phone: p.phone,
      name: p.contact_name || 'Unknown',
      address: p.prospects.situs_street || 'Unknown',
      city: p.prospects.situs_city || '',
      state: p.prospects.situs_state || 'MO',
      county: county
    })
    if (testCases.length >= 5) break
  }

  console.log(`Found ${testCases.length} test cases across counties: ${[...countySeen].join(', ')}\n`)

  const results = []

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i]
    console.log(`--- Test ${i + 1}/${testCases.length}: ${tc.county.toUpperCase()} County ---`)
    console.log(`  Name: ${tc.name}`)
    console.log(`  Phone: ${tc.phone}`)
    console.log(`  Address: ${tc.address}, ${tc.city}, ${tc.state}`)

    // Create booking with unique time slot
    const slotDate = new Date()
    slotDate.setDate(slotDate.getDate() + 10 + i)
    const slotDateStr = slotDate.toISOString().split('T')[0]
    const hour = 9 + i
    const slotDatetime = new Date(slotDate.setHours(hour, 0, 0, 0)).toISOString()
    const slotTime = `${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? 'PM' : 'AM'}`

    try {
      const response = await fetch('http://localhost:3002/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: `BROADTEST ${tc.name}`,
          phone: tc.phone,
          property_address: `${tc.address}, ${tc.city}, ${tc.state}`,
          slot_date: slotDateStr,
          slot_time: slotTime,
          slot_datetime: slotDatetime,
          source: 'broad_enrichment_test'
        })
      })

      const result = await response.json()

      if (!result.success) {
        console.log(`  ✗ Booking failed: ${result.error}`)
        results.push({ county: tc.county, booking: false, prospect: false, countyEnrich: false, error: result.error })
        continue
      }

      console.log(`  ✓ Booking: ${result.booking_id}`)

      // Get lead ID
      const { data: booking } = await supabase
        .from('bookings')
        .select('lead_id')
        .eq('id', result.booking_id)
        .single()

      const leadId = booking?.lead_id
      if (!leadId) {
        console.log(`  ✗ No lead ID found`)
        results.push({ county: tc.county, booking: true, prospect: false, countyEnrich: false, error: 'No lead ID' })
        continue
      }

      console.log(`  ✓ Lead: ${leadId}`)
      results.push({ county: tc.county, booking: true, leadId, prospect: false, countyEnrich: false })

    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`)
      results.push({ county: tc.county, booking: false, prospect: false, countyEnrich: false, error: err.message })
    }

    // Small delay between bookings
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  // Wait for enrichment to complete
  console.log(`\nWaiting 90 seconds for all enrichments to complete...\n`)
  await new Promise(resolve => setTimeout(resolve, 90000))

  // Check enrichment results
  console.log('=== ENRICHMENT RESULTS ===\n')

  let prospectSuccess = 0
  let countySuccess = 0
  let totalWithLeads = 0

  for (const r of results) {
    if (!r.leadId) continue
    totalWithLeads++

    const { data: manifest } = await supabase
      .from('manifests')
      .select('manifest')
      .eq('lead_id', r.leadId)
      .single()

    const auditTrail = manifest?.manifest?.auditTrail || []
    const prospectEvent = auditTrail.find(e => e.action === 'prospect_enrichment_complete')
    const countyEvent = auditTrail.find(e => e.action === 'county_enrichment_complete')

    r.prospect = !!prospectEvent
    r.countyEnrich = !!countyEvent

    if (prospectEvent) prospectSuccess++
    if (countyEvent) countySuccess++

    console.log(`${r.county.toUpperCase()} County (${r.leadId}):`)
    console.log(`  Prospect: ${r.prospect ? '✓ ENRICHED' : '✗ Not enriched'}`)
    console.log(`  County:   ${r.countyEnrich ? '✓ ENRICHED' : '✗ Not enriched'}`)

    // Show financials
    const f = manifest?.manifest?.financials || {}
    const tax = manifest?.manifest?.property?.taxCollector || {}
    const dwelling = manifest?.manifest?.property?.dwelling || {}
    if (f.arv) console.log(`  ARV: $${f.arv?.toLocaleString()}`)
    if (f.back_taxes) console.log(`  Back taxes: $${f.back_taxes?.toLocaleString()}`)
    if (tax.delinquentAmount) console.log(`  Delinquent: $${tax.delinquentAmount?.toLocaleString()}`)
    if (dwelling.sqft) console.log(`  Sqft: ${dwelling.sqft}`)
    if (dwelling.yearBuilt) console.log(`  Year built: ${dwelling.yearBuilt}`)
    console.log('')
  }

  // Final summary
  console.log('=== FINAL SUMMARY ===')
  console.log(`Bookings created: ${results.filter(r => r.booking).length}/${results.length}`)
  console.log(`Leads with manifests: ${totalWithLeads}`)
  console.log(`Prospect enrichment: ${prospectSuccess}/${totalWithLeads} (${totalWithLeads > 0 ? (prospectSuccess/totalWithLeads*100).toFixed(0) : 0}%)`)
  console.log(`County enrichment:   ${countySuccess}/${totalWithLeads} (${totalWithLeads > 0 ? (countySuccess/totalWithLeads*100).toFixed(0) : 0}%)`)

  const overallRate = totalWithLeads > 0
    ? ((prospectSuccess + countySuccess) / (totalWithLeads * 2) * 100).toFixed(0)
    : 0
  console.log(`Overall enrichment:  ${overallRate}%`)

  if (overallRate === '100') {
    console.log('\n🎉 100% ENRICHMENT SUCCESS ACROSS ALL COUNTIES!')
  } else {
    console.log(`\n⚠️  ${overallRate}% — Review failures above`)
  }

  // Show per-county breakdown
  console.log('\nPer-county breakdown:')
  for (const r of results) {
    const status = r.prospect && r.countyEnrich ? '✓✓' :
                   r.prospect || r.countyEnrich ? '✓✗' : '✗✗'
    console.log(`  ${status} ${r.county}: prospect=${r.prospect ? 'Y' : 'N'} county=${r.countyEnrich ? 'Y' : 'N'}${r.error ? ` (${r.error})` : ''}`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
