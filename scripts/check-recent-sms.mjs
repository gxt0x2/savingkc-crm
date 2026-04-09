#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

// Load env vars
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

const phone = '+19137179716'

console.log(`\n🔍 Checking recent SMS activity for ${phone}\n`)

const { data, error } = await supabase
  .from('lead_activities')
  .select('id, lead_id, activity_type, description, created_at, metadata')
  .eq('activity_type', 'sms')
  .order('created_at', { ascending: false })
  .limit(10)

if (error) {
  console.error('Error:', error)
} else {
  const recent = data.filter(a =>
    a.metadata?.from?.includes('9137179716') ||
    a.metadata?.to?.includes('9137179716') ||
    a.description?.includes('9137179716')
  )

  if (recent.length === 0) {
    console.log('❌ No recent SMS found in database')
    console.log('\nThis means:')
    console.log('- Twilio webhook did NOT fire')
    console.log('- OR webhook is configured for production, not localhost')
  } else {
    console.log(`✅ Found ${recent.length} recent SMS:\n`)
    recent.forEach(a => {
      const time = new Date(a.created_at).toLocaleString()
      const direction = a.metadata?.direction || '?'
      const trigger = a.metadata?.trigger || ''
      console.log(`${time} - ${direction}${trigger ? ` (${trigger})` : ''}`)
      console.log(`  ${a.description?.slice(0, 100)}`)
      console.log(`  Lead ID: ${a.lead_id}`)
      console.log()
    })
  }
}
