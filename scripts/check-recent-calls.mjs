import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkRecentCalls() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('RECENT CALL ACTIVITIES (Last 10)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const { data, error } = await supabase
    .from('lead_activities')
    .select('*')
    .eq('activity_type', 'call')
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('Error:', error)
    return
  }

  if (!data || data.length === 0) {
    console.log('❌ No call activities found in database')
    console.log('\nThis means the Twilio webhook is NOT reaching the CRM.')
    console.log('\nPossible issues:')
    console.log('  1. Twilio webhooks not configured')
    console.log('  2. Server not accessible from internet')
    console.log('  3. Webhook URL is wrong in Twilio')
    return
  }

  data.forEach((activity, i) => {
    const meta = activity.metadata || {}
    console.log(`${i + 1}. ${activity.description}`)
    console.log(`   Time: ${new Date(activity.created_at).toLocaleString()}`)
    console.log(`   From: ${meta.from || 'N/A'}`)
    console.log(`   Status: ${meta.callStatus || 'N/A'}`)
    console.log(`   Duration: ${meta.duration || 0}s`)
    console.log('')
  })

  const mostRecent = data[0]
  const timeSince = Date.now() - new Date(mostRecent.created_at).getTime()
  const minutesAgo = Math.floor(timeSince / 60000)

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Most recent call: ${minutesAgo} minute(s) ago`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

checkRecentCalls()
