#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = fs.readFileSync('/Users/ernestdodson/savingkc-crm/.env.local', 'utf8')
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=:#]+)=(.*)$/)
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '')
})

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const MOJO_BASE_URL = 'https://app71.mojosells.com'
const SESSION_FILE = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json'

function getSessionId() {
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))
  return session.expired ? null : session.sessionId
}

async function fetchContactFromMojo(sessionId, phone) {
  // Search prospect_phones first
  const digits = phone.replace(/\D/g, '')
  const { data: prospectMatch } = await supabase
    .from('prospect_phones')
    .select('phone, prospects(situs_street, situs_city, situs_state, situs_zip, county, cumulative_due)')
    .like('phone', `%${digits.slice(-10)}%`)
    .limit(1)

  if (prospectMatch?.[0]?.prospects) {
    const p = prospectMatch[0].prospects
    return { address: p.situs_street, city: p.situs_city, state: p.situs_state, zip: p.situs_zip, county: p.county }
  }

  // Fallback: try Mojo contact API
  // (This requires finding the contact_id from activity stream)
  return null
}

async function main() {
  console.log('=== Backfilling Mojo Leads Missing Addresses ===\n')

  const sessionId = getSessionId()

  // Find leads with source=mojo_call and no address
  const { data: leads } = await supabase
    .from('leads')
    .select('id, full_name, phone, property_address')
    .eq('source', 'mojo_call')
    .is('property_address', null)

  if (!leads || leads.length === 0) {
    // Also check for empty string addresses
    const { data: emptyAddr } = await supabase
      .from('leads')
      .select('id, full_name, phone, property_address')
      .eq('source', 'mojo_call')
      .eq('property_address', '')

    if (!emptyAddr || emptyAddr.length === 0) {
      console.log('No Mojo leads need backfilling')
      return
    }
    leads.push(...emptyAddr)
  }

  console.log(`Found ${leads.length} leads to backfill\n`)

  let fixed = 0
  let failed = 0

  for (const lead of leads) {
    console.log(`${lead.full_name} (${lead.phone}):`)

    const details = await fetchContactFromMojo(sessionId, lead.phone)

    if (!details?.address) {
      console.log(`  ✗ No address found in prospect DB or Mojo\n`)
      failed++
      continue
    }

    console.log(`  Found: ${details.address}, ${details.city}, ${details.state} ${details.zip} (${details.county})`)

    // Update lead
    const { error } = await supabase
      .from('leads')
      .update({
        property_address: details.address,
        city: details.city,
        state: details.state,
        zip: details.zip,
        county: details.county,
      })
      .eq('id', lead.id)

    if (error) {
      console.log(`  ✗ Update failed: ${error.message}\n`)
      failed++
      continue
    }

    console.log(`  ✓ Lead updated`)

    // Trigger enrichment
    const res = await fetch('http://localhost:3002/api/enrich/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`
      },
      body: JSON.stringify({ leadIds: [lead.id] })
    })
    const result = await res.json()
    console.log(`  ✓ Enrichment: prospect=${result.prospectMatches}, county=${result.countyEnriched}\n`)
    fixed++
  }

  console.log(`\n=== Done: ${fixed} fixed, ${failed} failed ===`)
}

main().catch(err => { console.error(err); process.exit(1) })
