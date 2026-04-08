import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkSchema() {
  console.log('Checking agent_profiles table schema...\n')

  // Query the information_schema to see actual columns
  const { data, error } = await supabase
    .from('agent_profiles')
    .select('*')
    .limit(1)

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('Current columns in agent_profiles:')
  console.log(Object.keys(data[0] || {}))
  console.log('\nExpected columns:')
  console.log('- voicemail_recording_url (MISSING!)')
  console.log('- profile_photo_url (should exist)')
}

checkSchema()
