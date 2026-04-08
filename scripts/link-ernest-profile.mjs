import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function linkProfile() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('LINKING OAUTH EMAIL TO ERNEST PROFILE')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const oauthEmail = '0gw2p3l0w@znx.jsi4'
  const targetEmail = 'ernest@savingkc.com'

  console.log('OAuth email:', oauthEmail)
  console.log('Target profile:', targetEmail)
  console.log('')

  // Update Ernest's profile to use the OAuth email
  const { data, error } = await supabase
    .from('agent_profiles')
    .update({ email: oauthEmail })
    .eq('email', targetEmail)
    .select()

  if (error) {
    console.error('❌ Error:', error)
    return
  }

  if (!data || data.length === 0) {
    console.error('❌ Profile not found for:', targetEmail)
    return
  }

  console.log('✅ Successfully linked!')
  console.log('')
  console.log('Profile details:')
  console.log('  Name:', data[0].full_name)
  console.log('  Email (old):', targetEmail)
  console.log('  Email (new):', data[0].email)
  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ DONE - Reload the CRM and your profile will load!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

linkProfile()
