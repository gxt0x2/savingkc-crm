import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fixEmailBack() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('REVERTING EMAIL BACK TO ernest@savingkc.com')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const { data, error } = await supabase
    .from('agent_profiles')
    .update({ email: 'ernest@savingkc.com' })
    .eq('email', '0gw2p3l0w@znx.jsi4')
    .select()

  if (error) {
    console.error('❌ Error:', error)
    return
  }

  if (!data || data.length === 0) {
    console.error('❌ Profile not found')
    return
  }

  console.log('✅ Email changed back successfully!')
  console.log('')
  console.log('Profile:')
  console.log('  Name:', data[0].full_name)
  console.log('  Email:', data[0].email)
  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ FIXED - Email is now ernest@savingkc.com')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

fixEmailBack()
