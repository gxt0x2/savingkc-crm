import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkProfiles() {
  const { data, error } = await supabase
    .from('agent_profiles')
    .select('email, full_name, profile_photo_url')
    .order('email')

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('AGENT PROFILES IN DATABASE')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  data.forEach((profile, i) => {
    console.log(`${i + 1}. ${profile.full_name || 'No name'}`)
    console.log(`   Email: ${profile.email}`)
    console.log(`   Photo URL: ${profile.profile_photo_url ? 'EXISTS (' + profile.profile_photo_url.substring(0, 50) + '...)' : 'NULL'}`)
    console.log('')
  })
}

checkProfiles()
