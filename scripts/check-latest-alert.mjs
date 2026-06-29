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

console.log('\n🔍 Checking latest SMS alert delivery status...\n')

const { data, error } = await supabase
  .from('lead_activities')
  .select('*')
  .eq('activity_type', 'sms')
  .eq('metadata->>trigger', 'lead_reply_alert')
  .order('created_at', { ascending: false })
  .limit(1)

if (error || !data || data.length === 0) {
  console.log('❌ No alerts found')
  process.exit(1)
}

const alert = data[0]
const time = new Date(alert.created_at).toLocaleString()

console.log(`Latest alert: ${time}`)
console.log(`Message: ${alert.description?.slice(0, 100)}\n`)

const deliveryStatus = alert.metadata?.delivery_status

if (!deliveryStatus) {
  console.log('⚠️  No delivery_status in metadata')
  console.log('This means the OLD code processed this alert (before deployment)\n')
  console.log('Full metadata:')
  console.log(JSON.stringify(alert.metadata, null, 2))
} else {
  console.log('📊 Delivery Status:\n')

  const casey = deliveryStatus.casey
  const ernest = deliveryStatus.ernest

  console.log(`Casey (+18167564943):`)
  console.log(`  Success: ${casey.success ? '✅' : '❌'}`)
  if (casey.success) {
    console.log(`  Twilio SID: ${casey.sid}`)
  } else {
    console.log(`  Error: ${casey.error}`)
  }

  console.log(`\nErnest (+18162262552):`)
  console.log(`  Success: ${ernest.success ? '✅' : '❌'}`)
  if (ernest.success) {
    console.log(`  Twilio SID: ${ernest.sid}`)
  } else {
    console.log(`  Error: ${ernest.error}`)
  }

  if (!casey.success && !ernest.success) {
    console.log('\n🚨 BOTH ALERTS FAILED!')
  } else if (!casey.success || !ernest.success) {
    console.log('\n⚠️  One alert failed')
  } else {
    console.log('\n✅ Both alerts sent successfully')
  }
}
