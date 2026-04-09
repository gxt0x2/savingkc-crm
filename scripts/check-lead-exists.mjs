#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

// Load env vars from .env.local
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

const phone = process.argv[2] || '+19137179716'

const { data, error } = await supabase
  .from('leads')
  .select('id, full_name, phone, priority')
  .ilike('phone', `%${phone.replace(/\D/g, '').slice(-10)}%`)

if (error) {
  console.error('Error:', error)
} else if (!data || data.length === 0) {
  console.log(`❌ No lead found for ${phone}`)
  console.log('\nThis means when you text from this number:')
  console.log('- A NEW lead will be created')
  console.log('- Alerts will go to Casey and Ernest for "new unknown SMS"')
} else {
  data.forEach(lead => {
    console.log(`✅ Found: ${lead.full_name} (${lead.phone})`)
    console.log(`   Lead ID: ${lead.id}`)
    console.log(`   Priority: ${lead.priority || 'normal'}`)
    console.log('\nThis means when you text from this number:')
    console.log('- It will be treated as EXISTING lead')
    console.log('- Both Casey and Ernest will get SMS alerts')
    console.log(`- Alert: "📩 ${lead.full_name} just texted: [message]"`)
  })
}
