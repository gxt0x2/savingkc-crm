#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = fs.readFileSync('/Users/ernestdodson/savingkc-crm/.env.local', 'utf8')
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=:#]+)=(.*)$/)
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '')
})

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('=== DIRECT ENRICHMENT TEST — All 3 Counties ===\n')

  // Get one prospect per county with phone
  const counties = ['jackson', 'clay', 'johnson']
  const testCases = []

  for (const county of counties) {
    // Get a prospect that has a phone via join
    const { data } = await supabase
      .from('prospect_phones')
      .select('phone, contact_name, prospects!inner(id, situs_street, situs_city, situs_state, county, owner_1, cumulative_due)')
      .eq('prospects.county', county)
      .not('prospects.situs_street', 'is', null)
      .limit(1)

    if (!data || data.length === 0) {
      console.log(`${county}: No prospects with phone+address found`)
      continue
    }

    const row = data[0]
    const p = row.prospects
    testCases.push({
      county,
      phone: row.phone,
      address: p.situs_street,
      city: p.situs_city || '',
      state: p.situs_state || (county === 'johnson' ? 'KS' : 'MO'),
      owner: p.owner_1 || row.contact_name,
      debt: p.cumulative_due
    })
  }

  console.log(`Found ${testCases.length} test cases\n`)

  // Create fresh leads and trigger enrichment directly via API
  for (const tc of testCases) {
    console.log(`--- ${tc.county.toUpperCase()} COUNTY ---`)
    console.log(`  ${tc.owner} | ${tc.address}, ${tc.city}, ${tc.state}`)
    console.log(`  Phone: ${tc.phone} | Debt: $${tc.debt?.toLocaleString() || 0}`)

    // Create a fresh lead directly in DB with unique phone for this test
    const uniquePhone = tc.phone // Use real phone for prospect matching
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .insert({
        full_name: `ENRICH-TEST ${tc.owner}`,
        phone: uniquePhone,
        property_address: tc.address,
        city: tc.city,
        state: tc.state,
        county: tc.county,
        source: 'manual',
        station: 'intake'
      })
      .select('id')
      .single()

    if (leadError) {
      console.log(`  ✗ Lead creation failed: ${leadError.message}`)
      continue
    }

    console.log(`  ✓ Lead: ${lead.id}`)
    tc.leadId = lead.id

    // Trigger enrichment via the enrich/batch API
    const res = await fetch('http://localhost:3002/api/enrich/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`
      },
      body: JSON.stringify({ leadIds: [lead.id] })
    })

    const result = await res.json()
    console.log(`  Enrich response: ${JSON.stringify(result)}`)
    console.log('')
  }

  // Wait for enrichments
  console.log('Waiting 90 seconds for enrichments to complete...\n')
  await new Promise(r => setTimeout(r, 90000))

  // Check results
  console.log('=== RESULTS ===\n')

  let prospectPass = 0
  let countyPass = 0
  let total = 0

  for (const tc of testCases) {
    if (!tc.leadId) continue
    const leadId = tc.leadId
    total++

    const { data: m } = await supabase.from('manifests').select('manifest').eq('lead_id', leadId).single()
    const trail = m?.manifest?.auditTrail || []
    const p = trail.find(e => e.action === 'prospect_enrichment_complete')
    const c = trail.find(e => e.action === 'county_enrichment_complete')
    const f = m?.manifest?.financials || {}
    const d = m?.manifest?.property?.dwelling || {}
    const t = m?.manifest?.property?.taxCollector || {}

    console.log(`${tc.county.toUpperCase()}:`)
    console.log(`  Prospect: ${p ? '✓' : '✗'}  County: ${c ? '✓' : '✗'}`)
    if (f.arv) console.log(`  ARV: $${f.arv.toLocaleString()}`)
    if (f.back_taxes) console.log(`  Back taxes: $${f.back_taxes.toLocaleString()}`)
    if (t.delinquentAmount) console.log(`  Delinquent: $${t.delinquentAmount.toLocaleString()}`)
    if (d.sqft) console.log(`  Sqft: ${d.sqft} | Year: ${d.yearBuilt || 'N/A'}`)
    console.log('')

    if (p) prospectPass++
    if (c) countyPass++
  }

  console.log(`=== FINAL ===`)
  console.log(`Prospect: ${prospectPass}/${total}`)
  console.log(`County: ${countyPass}/${total}`)
  const rate = total > 0 ? ((prospectPass + countyPass) / (total * 2) * 100).toFixed(0) : 0
  console.log(`Overall: ${rate}% (${prospectPass + countyPass}/${total * 2})`)
  if (rate === '100') console.log('\n🎉 100% ALL COUNTIES!')
}

main().catch(err => { console.error(err); process.exit(1) })
