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

console.log(`\n🔍 Checking SMS alert details...\n`)

const { data, error } = await supabase
  .from('lead_activities')
  .select('*')
  .eq('activity_type', 'sms')
  .eq('metadata->>trigger', 'lead_reply_alert')
  .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
  .order('created_at', { ascending: false })

if (error) {
  console.error('Error:', error)
} else if (!data || data.length === 0) {
  console.log('❌ No alert found')
} else {
  const alert = data[0]
  console.log(`Alert logged at: ${new Date(alert.created_at).toLocaleString()}`)
  console.log(`Description: ${alert.description}`)
  console.log(`\nMetadata:`)
  console.log(`  Trigger: ${alert.metadata?.trigger}`)
  console.log(`  Direction: ${alert.metadata?.direction}`)
  console.log(`  To Agents: ${alert.metadata?.to_agents?.join(', ')}`)
  console.log(`  From Number: ${alert.metadata?.from || 'NOT RECORDED'}`)
  console.log(`  To Number: ${alert.metadata?.to || 'NOT RECORDED'}`)

  console.log('\n⚠️  This log entry shows the INTENT to send alerts.')
  console.log('It does NOT mean the SMS was actually sent via Twilio.')
  console.log('\nChecking if safeSendSMS actually succeeded...')
}

// Now check for actual outbound SMS that went to Ernest/Casey
console.log('\n\n🔍 Checking for actual outbound SMS to team phones...\n')

const ERNEST = env.ERNEST_PHONE
const CASEY = env.CASEY_PHONE

const { data: outbound } = await supabase
  .from('lead_activities')
  .select('*')
  .eq('activity_type', 'sms')
  .eq('metadata->>direction', 'outbound')
  .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
  .order('created_at', { ascending: false })

const toErnest = outbound?.filter(s => s.metadata?.to?.includes(ERNEST.slice(-10)))
const toCasey = outbound?.filter(s => s.metadata?.to?.includes(CASEY.slice(-10)))

console.log(`Ernest's phone: ${ERNEST}`)
console.log(`Casey's phone: ${CASEY}`)
console.log(`\nOutbound SMS to Ernest in last hour: ${toErnest?.length || 0}`)
console.log(`Outbound SMS to Casey in last hour: ${toCasey?.length || 0}`)

if (toErnest && toErnest.length > 0) {
  console.log(`\n✅ SMS to Ernest:`)
  toErnest.slice(0, 3).forEach(s => {
    console.log(`  ${new Date(s.created_at).toLocaleString()}`)
    console.log(`    From: ${s.metadata?.from}`)
    console.log(`    To: ${s.metadata?.to}`)
    console.log(`    Message: ${s.description?.slice(0, 80)}`)
  })
}

if (toCasey && toCasey.length > 0) {
  console.log(`\n✅ SMS to Casey:`)
  toCasey.slice(0, 3).forEach(s => {
    console.log(`  ${new Date(s.created_at).toLocaleString()}`)
    console.log(`    From: ${s.metadata?.from}`)
    console.log(`    To: ${s.metadata?.to}`)
    console.log(`    Message: ${s.description?.slice(0, 80)}`)
  })
}

if ((!toErnest || toErnest.length === 0) && (!toCasey || toCasey.length === 0)) {
  console.log('\n❌ NO actual SMS sent to team phones!')
  console.log('\nThis means safeSendSMS() is NOT logging to lead_activities.')
  console.log('The alerts may have been sent via Twilio but not logged.')
}
