#!/usr/bin/env node

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// Read Supabase credentials from .env.local
const envPath = process.env.HOME + '/savingkc-crm/.env.local'
const envContent = readFileSync(envPath, 'utf-8')

const supabaseUrl = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim()
const supabaseKey = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim()

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

console.log('🔍 Checking Zillow fallback test lead...\n')

// Find lead by phone
const { data: lead } = await supabase
  .from('leads')
  .select('*')
  .eq('phone', '+15555551234')
  .order('created_at', { ascending: false })
  .limit(1)
  .single()

if (!lead) {
  console.log('❌ Lead not found')
  process.exit(1)
}

console.log('✅ Lead found:', lead.id)
console.log('   Name:', lead.name)
console.log('   Address:', lead.address)
console.log('   City/State/Zip:', lead.city, lead.state, lead.zip)
console.log('   Station:', lead.station)
console.log('   Lot Size:', lead.lot_size)
console.log('   Last Sale:', lead.last_sale_date, lead.last_sale_price)
console.log()

// Find manifest
const { data: manifests } = await supabase
  .from('manifests')
  .select('*')
  .eq('lead_id', lead.id)

console.log(`📋 Found ${manifests.length} manifest(s)`)

if (manifests.length === 0) {
  console.log('⚠️  No manifest created yet (auto-enrich may still be running)')
  process.exit(0)
}

if (manifests.length > 1) {
  console.log('❌ MULTIPLE MANIFESTS - Race condition detected!')
  process.exit(1)
}

const manifest = manifests[0]

console.log('\n✅ Manifest found:', manifest.id)
console.log('   Station:', manifest.station)
console.log('   Hot Score:', manifest.hot_score)
console.log('   Created By:', manifest.metadata?.created_by)
console.log()

// Check property enrichment
const prop = manifest.property || {}
console.log('🏠 Property Data:')
console.log('   Lot Size (sqft):', prop.lot?.sizeSqft)
console.log('   Lot Size (acres):', prop.lot?.sizeAcres)
console.log('   Last Sale Date:', prop.sales?.lastSaleDate)
console.log('   Last Sale Price:', prop.sales?.lastSalePrice)
console.log('   Year Built:', prop.yearBuilt)
console.log('   Square Feet:', prop.sqft)
console.log('   Appraised Value:', prop.appraisedValue)
console.log()

// Check financials
const fin = manifest.financials || {}
console.log('💰 Financials:')
console.log('   ARV:', fin.arv)
console.log('   ARV Source:', fin.arv_source)
console.log()

// Check audit trail for enrichment events
const trail = manifest.auditTrail || []
console.log('📝 Audit Trail (' + trail.length + ' events):')
trail.slice(-5).forEach(event => {
  console.log(`   ${event.timestamp.substring(0, 19)} | ${event.agent} | ${event.action}`)
})

// Check for Zillow enrichment
const zillowEvents = trail.filter(e => e.action?.includes('zillow'))
if (zillowEvents.length > 0) {
  console.log('\n✅ Zillow enrichment occurred!')
  zillowEvents.forEach(e => {
    console.log('   Details:', JSON.stringify(e.details))
  })
} else {
  console.log('\n⚠️  No Zillow enrichment events found in audit trail')
}

// Check for county enrichment
const countyEvents = trail.filter(e => e.action?.includes('county'))
if (countyEvents.length > 0) {
  console.log('\n✅ County enrichment occurred!')
} else {
  console.log('\n⚠️  No county enrichment events found')
}
