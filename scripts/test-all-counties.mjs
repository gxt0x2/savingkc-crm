#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = fs.readFileSync('/Users/ernestdodson/savingkc-crm/.env.local', 'utf8')
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=:#]+)=(.*)$/)
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '')
})

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function getProspectForCounty(county) {
  const { data } = await supabase
    .from('prospect_phones')
    .select('phone, contact_name, prospects!inner(situs_street, situs_city, county)')
    .eq('relationship', 'owner')
    .eq('prospects.county', county)
    .limit(1)
    .single()
  return data
}

async function main() {
  console.log('=== MULTI-COUNTY ENRICHMENT TEST ===\n')

  const counties = ['jackson', 'clay', 'johnson']
  const leadIds = []

  for (let i = 0; i < counties.length; i++) {
    const county = counties[i]
    console.log(`--- ${county.toUpperCase()} COUNTY ---`)

    const prospect = await getProspectForCounty(county)
    if (!prospect) {
      console.log('  ✗ No prospect with phone found\n')
      continue
    }

    console.log(`  ${prospect.contact_name}: ${prospect.prospects.situs_street}, ${prospect.prospects.situs_city}`)

    const slotDate = new Date()
    slotDate.setDate(slotDate.getDate() + 30 + Math.floor(Math.random() * 30) + i * 5)
    const slotDateStr = slotDate.toISOString().split('T')[0]
    const hour = 9 + i + Math.floor(Math.random() * 4)
    const slotDatetime = new Date(slotDate.setHours(hour, 0, 0, 0)).toISOString()

    const res = await fetch('http://localhost:3002/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: `COUNTY-TEST ${prospect.contact_name}`,
        phone: prospect.phone,
        property_address: `${prospect.prospects.situs_street}, ${prospect.prospects.situs_city}, MO`,
        slot_date: slotDateStr,
        slot_time: `${hour}:00 AM`,
        slot_datetime: slotDatetime,
        source: 'county_test'
      })
    })

    const result = await res.json()
    if (!result.success) {
      console.log(`  ✗ Booking failed: ${result.error}\n`)
      continue
    }

    const { data: booking } = await supabase.from('bookings').select('lead_id').eq('id', result.booking_id).single()
    console.log(`  ✓ Lead: ${booking.lead_id}`)
    leadIds.push({ county, leadId: booking.lead_id })
    console.log('')

    await new Promise(r => setTimeout(r, 2000))
  }

  console.log(`Waiting 90 seconds for enrichments...\n`)
  await new Promise(r => setTimeout(r, 90000))

  console.log('=== RESULTS ===\n')

  let pass = 0
  let total = leadIds.length

  for (const { county, leadId } of leadIds) {
    const { data: m } = await supabase.from('manifests').select('manifest').eq('lead_id', leadId).single()
    const trail = m?.manifest?.auditTrail || []
    const p = trail.find(e => e.action === 'prospect_enrichment_complete')
    const c = trail.find(e => e.action === 'county_enrichment_complete')
    const f = m?.manifest?.financials || {}
    const d = m?.manifest?.property?.dwelling || {}
    const t = m?.manifest?.property?.taxCollector || {}

    console.log(`${county.toUpperCase()}:`)
    console.log(`  Prospect: ${p ? '✓' : '✗'}  County: ${c ? '✓' : '✗'}`)
    if (f.arv) console.log(`  ARV: $${f.arv.toLocaleString()}`)
    if (f.back_taxes) console.log(`  Back taxes: $${f.back_taxes.toLocaleString()}`)
    if (t.delinquentAmount) console.log(`  Delinquent: $${t.delinquentAmount.toLocaleString()}`)
    if (d.sqft) console.log(`  Sqft: ${d.sqft} | Year: ${d.yearBuilt || 'N/A'}`)
    console.log('')

    if (p) pass++
    if (c) pass++
  }

  const rate = total > 0 ? (pass / (total * 2) * 100).toFixed(0) : 0
  console.log(`=== ${rate}% overall (${pass}/${total * 2} enrichments) ===`)
  if (rate === '100') console.log('🎉 ALL COUNTIES PASSING!')
}

main().catch(err => { console.error(err); process.exit(1) })
