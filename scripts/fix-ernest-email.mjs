import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fixEmail() {
  console.log('Updating Ernest profile email to match auth email...')

  const { data, error } = await supabase
    .from('agent_profiles')
    .update({ email: '0gw2p3l0w@znx.jsi4' })
    .eq('email', 'ernest@savingkc.com')
    .select()

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('✅ Updated successfully!')
  console.log('Profile now uses email:', data[0].email)
  console.log('\nNow reload the CRM and the profile will load correctly.')
}

fixEmail()
