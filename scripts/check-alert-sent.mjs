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

console.log(`\n🔍 Checking if SMS alerts were sent to team...\n`)

const { data, error } = await supabase
  .from('lead_activities')
  .select('*')
  .eq('activity_type', 'sms')
  .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
  .order('created_at', { ascending: false })

if (error) {
  console.error('Error:', error)
} else {
  const alerts = data.filter(a =>
    a.metadata?.trigger === 'lead_reply_alert' ||
    a.metadata?.trigger === 'hot_lead_reply_alert' ||
    a.metadata?.direction === 'outbound_alert'
  )

  if (alerts.length === 0) {
    console.log('❌ NO ALERTS FOUND in last hour')
    console.log('\nThis means the new code did NOT send alerts.')
    console.log('Reason: Production is still running OLD code.')
    console.log('\nYou need to DEPLOY the new code to production!')
  } else {
    console.log(`✅ Found ${alerts.length} alert(s):\n`)
    alerts.forEach(a => {
      const time = new Date(a.created_at).toLocaleString()
      const toAgents = a.metadata?.to_agents || []
      console.log(`${time}`)
      console.log(`  Alert: ${a.description?.slice(0, 120)}`)
      console.log(`  Sent to: ${toAgents.join(', ')}`)
      console.log(`  Trigger: ${a.metadata?.trigger}`)
      console.log()
    })
  }
}
