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
  console.log('=== PLATTE COUNTY ENRICHMENT TEST ===\n')

  // Create a test lead with a Platte County address
  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      full_name: 'PLATTE-TEST RENDLEMAN',
      phone: `+1555${Date.now().toString().slice(-7)}`,
      property_address: '7017 NW WINTER AVE',
      city: 'Kansas City',
      state: 'MO',
      county: 'platte',
      source: 'manual',
      station: 'intake'
    })
    .select('id')
    .single()

  if (error) {
    console.error('Lead creation failed:', error.message)
    process.exit(1)
  }

  console.log(`✓ Lead created: ${lead.id}`)
  console.log('  Address: 7017 NW WINTER AVE, Kansas City, MO')
  console.log('  County: Platte\n')

  // Trigger enrichment via batch API
  console.log('Triggering enrichment...')
  const res = await fetch('http://localhost:3002/api/enrich/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CRON_SECRET}`
    },
    body: JSON.stringify({ leadIds: [lead.id] })
  })

  const result = await res.json()
  console.log(`Enrich response: ${JSON.stringify(result)}\n`)

  // Wait for enrichment
  console.log('Waiting 30 seconds for enrichment...\n')
  await new Promise(r => setTimeout(r, 30000))

  // Check results
  const { data: manifest } = await supabase
    .from('manifests')
    .select('manifest')
    .eq('lead_id', lead.id)
    .single()

  if (!manifest) {
    console.log('✗ No manifest found')
    process.exit(1)
  }

  const m = manifest.manifest
  console.log('=== ENRICHMENT RESULTS ===\n')

  console.log('Property:')
  console.log(`  Parcel: ${m.property?.parcel || 'N/A'}`)
  console.log(`  Assessment: $${m.property?.assessment?.totalValue?.toLocaleString() || 'N/A'}`)
  console.log(`  Land: $${m.property?.assessment?.landValue?.toLocaleString() || 'N/A'}`)
  console.log(`  Improvements: $${m.property?.assessment?.improvementValue?.toLocaleString() || 'N/A'}`)

  console.log('\nDwelling:')
  console.log(`  Sqft: ${m.property?.dwelling?.sqft || 'N/A'}`)
  console.log(`  Year Built: ${m.property?.dwelling?.yearBuilt || 'N/A'}`)
  console.log(`  Bedrooms: ${m.property?.dwelling?.bedrooms || 'N/A'}`)
  console.log(`  Bathrooms: ${m.property?.dwelling?.bathrooms || 'N/A'}`)
  console.log(`  Style: ${m.property?.dwelling?.style || 'N/A'}`)

  console.log('\nTax:')
  console.log(`  Delinquent Amount: $${m.property?.taxCollector?.delinquentAmount?.toLocaleString() || '0'}`)
  console.log(`  Status: ${m.property?.taxCollector?.status || 'N/A'}`)

  console.log('\nOwner:')
  console.log(`  Name: ${m.owner?.firstName} ${m.owner?.lastName}`)

  // Check audit trail
  const trail = m.auditTrail || []
  const countyEvent = trail.find((e) => e.action === 'county_enrichment_complete')
  console.log(`\nCounty enrichment audit: ${countyEvent ? '✓ FOUND' : '✗ NOT FOUND'}`)
  if (countyEvent) {
    console.log(`  Source: ${countyEvent.details?.source}`)
  }

  const hasData = m.property?.dwelling?.sqft || m.property?.assessment?.totalValue
  console.log(`\n${hasData ? '✓ PLATTE COUNTY ENRICHMENT SUCCESS!' : '✗ No enrichment data found'}`)
}

main().catch(err => { console.error(err); process.exit(1) })
