#!/usr/bin/env node

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse/sync'

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

// Parse CSV with proper library
function parseCSV(content) {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    cast: (value, context) => {
      // Convert empty strings, 'None', 'nan' to null
      if (!value || value === 'None' || value === 'nan' || value === '') {
        return null
      }
      // Convert booleans
      if (value === 'True' || value === 'true') return true
      if (value === 'False' || value === 'false') return false
      // Try to parse numbers for numeric columns
      if (context.column && ['cumulative_due', 'earliest_delinquent_year', 'total_market_value', 'zestimate', 'owner_age'].includes(context.column)) {
        const num = parseFloat(value)
        return isNaN(num) ? null : num
      }
      return value
    }
  })
  return records
}

// Insert in batches
async function insertBatch(table, rows, batchSize = 500) {
  let inserted = 0
  let errors = 0

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await supabase.from(table).insert(batch)

    if (error) {
      console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, error.message)
      errors += batch.length
    } else {
      inserted += batch.length
      console.log(`✓ ${table}: ${inserted}/${rows.length} (${Math.round(inserted / rows.length * 100)}%)`)
    }
  }

  return { inserted, errors }
}

async function main() {
  console.log('🚀 Starting prospect import...\n')

  // Step 1: Import prospects
  console.log('📊 Reading prospects_import.csv...')
  const prospectsCSV = readFileSync('./prospects_import.csv', 'utf-8')
  const prospects = parseCSV(prospectsCSV)
  console.log(`   Found ${prospects.length} prospects\n`)

  console.log('💾 Inserting prospects...')
  const { inserted: prospectCount, errors: prospectErrors } = await insertBatch('prospects', prospects)
  console.log(`✅ Prospects: ${prospectCount} inserted, ${prospectErrors} errors\n`)

  // Step 2: Import prospect phones
  console.log('📊 Reading prospect_phones_import.csv...')
  const phonesCSV = readFileSync('./prospect_phones_import.csv', 'utf-8')
  const phones = parseCSV(phonesCSV)
  console.log(`   Found ${phones.length} phone numbers\n`)

  console.log('💾 Inserting prospect phones...')
  const { inserted: phoneCount, errors: phoneErrors } = await insertBatch('prospect_phones', phones)
  console.log(`✅ Phones: ${phoneCount} inserted, ${phoneErrors} errors\n`)

  // Step 3: Verify
  console.log('🔍 Verifying import...')
  const { count: verifyProspects } = await supabase.from('prospects').select('*', { count: 'exact', head: true })
  const { count: verifyPhones } = await supabase.from('prospect_phones').select('*', { count: 'exact', head: true })
  const { data: testPhone } = await supabase.from('prospect_phones').select('*').eq('phone', '+18168063163')

  console.log(`   Prospects in DB: ${verifyProspects}`)
  console.log(`   Phones in DB: ${verifyPhones}`)
  console.log(`   Test phone (+18168063163): ${testPhone?.length || 0} matches`)

  console.log('\n✅ Import complete!')
}

main().catch(err => {
  console.error('❌ Fatal error:', err)
  process.exit(1)
})
