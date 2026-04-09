#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const envFile = readFileSync('.env.local', 'utf8')
const env = {}
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/)
  if (match) env[match[1]] = match[2]
})

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('\n📦 Creating sms_delivery_log table...\n')

// Check if table exists
const { data: existing } = await supabase
  .from('sms_delivery_log')
  .select('id')
  .limit(1)

if (existing) {
  console.log('✅ Table sms_delivery_log already exists')
  process.exit(0)
}

console.log('⚠️  Table does not exist.')
console.log('\nPlease run this SQL in Supabase Studio SQL Editor:')
console.log('https://supabase.com/dashboard/project/fprrknfyzlthbxewnwmi/sql/new')
console.log('\n' + '='.repeat(80))

const sql = readFileSync('supabase/migrations/20260408_sms_delivery_tracking.sql', 'utf8')
console.log(sql)
console.log('='.repeat(80) + '\n')

console.log('Or use the Supabase CLI:')
console.log('  supabase db push\n')
