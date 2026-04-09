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
  console.log('Searching for Casey\'s phone number...')

  // Search for any variation of Casey's number
  const searches = [
    '+18167564943',
    '18167564943',
    '8167564943',
    '(816) 756-4943',
    '816-756-4943'
  ]

  for (const phone of searches) {
    console.log(`\nSearching for: "${phone}"`)

    const { data, error } = await supabase
      .from('prospect_phones')
      .select('phone, contact_name, relationship')
      .eq('phone', phone)
      .limit(5)

    if (error) {
      console.error('Error:', error.message)
    } else if (data && data.length > 0) {
      console.log(`✓ FOUND ${data.length} match(es):`)
      data.forEach(row => {
        console.log(`  - ${row.phone} (${row.relationship}): ${row.contact_name || 'N/A'}`)
      })
    } else {
      console.log('  ✗ No matches')
    }
  }

  // Also check with LIKE
  console.log('\n\nSearching with LIKE %756494%:')
  const { data: likeData, error: likeError } = await supabase
    .from('prospect_phones')
    .select('phone, contact_name, relationship')
    .like('phone', '%7564943%')
    .limit(10)

  if (likeError) {
    console.error('Error:', likeError.message)
  } else if (likeData && likeData.length > 0) {
    console.log(`✓ FOUND ${likeData.length} match(es):`)
    likeData.forEach(row => {
      console.log(`  - ${row.phone} (${row.relationship}): ${row.contact_name || 'N/A'}`)
    })
  } else {
    console.log('  ✗ No matches')
  }

  // Count total prospect_phones records
  console.log('\n\nChecking table size...')
  const { count, error: countError } = await supabase
    .from('prospect_phones')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    console.error('Error:', countError.message)
  } else {
    console.log(`Total prospect_phones records: ${count}`)
  }

  // Sample first 5 records to see format
  console.log('\n\nSample phone numbers from database:')
  const { data: sampleData } = await supabase
    .from('prospect_phones')
    .select('phone, contact_name')
    .limit(5)

  if (sampleData) {
    sampleData.forEach(row => {
      console.log(`  - "${row.phone}" (${row.contact_name || 'N/A'})`)
    })
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
