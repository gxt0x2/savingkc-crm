#!/usr/bin/env node
/**
 * Optional database copy of the foreclosure sample homeowner.
 *
 * Preview and local dev already return this contact from
 * GET /api/prospecting/foreclosure without writing. Open:
 *   /prospecting/foreclosure/f7220000-0000-4000-8000-000000000001
 * Name: Sample Homeowner
 * Phones: (816) 555-0101 mobile, (816) 555-0198 landline. Fictional. Labeled Sample.
 *
 * This script upserts that one row only when you pass
 * FORECLOSURE_SAMPLE_SEED_CONFIRM=1 and service-role credentials are available
 * in the environment or .env.local. It refuses when VERCEL_ENV=production.
 *
 *   FORECLOSURE_SAMPLE_SEED_CONFIRM=1 npx tsx scripts/seed-foreclosure-sample-contact.mts
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { foreclosureSampleDatabaseRow, FORECLOSURE_SAMPLE_ID } from '../src/lib/prospecting/foreclosure-sample'

function loadEnvFile(path: string) {
  try {
    const text = readFileSync(path, 'utf8')
    for (const line of text.split('\n')) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
      if (!match || process.env[match[1]]) continue
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  } catch {
    // Missing .env.local is fine when the variables are already exported.
  }
}

loadEnvFile('.env.local')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (process.env.VERCEL_ENV === 'production') {
  console.error('Refusing to seed while VERCEL_ENV=production.')
  process.exit(1)
}

if (process.env.FORECLOSURE_SAMPLE_SEED_CONFIRM !== '1') {
  console.log('Preview already shows Sample Homeowner without a database write.')
  console.log(`Open /prospecting/foreclosure/${FORECLOSURE_SAMPLE_ID}`)
  console.log('Phones: (816) 555-0101 mobile and (816) 555-0198 landline.')
  console.log('To copy that one row into a database, re-run with FORECLOSURE_SAMPLE_SEED_CONFIRM=1.')
  process.exit(0)
}

if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then re-run with FORECLOSURE_SAMPLE_SEED_CONFIRM=1.')
  process.exit(1)
}

const row = foreclosureSampleDatabaseRow()
const supabase = createClient(url, key)
const existing = await supabase
  .from('mortgage_foreclosure_prospects')
  .select('id')
  .eq('external_row_id', row.external_row_id)
  .maybeSingle()

if (existing.error) {
  console.error(existing.error.message)
  process.exit(1)
}

const saved = existing.data
  ? await supabase.from('mortgage_foreclosure_prospects').update(row).eq('id', existing.data.id).select('id').single()
  : await supabase.from('mortgage_foreclosure_prospects').insert(row).select('id').single()

if (saved.error || !saved.data) {
  console.error(saved.error?.message || 'Sample contact was not saved.')
  process.exit(1)
}

console.log(`Sample Homeowner saved as ${saved.data.id}`)
console.log(`Open /prospecting/foreclosure/${saved.data.id}`)
