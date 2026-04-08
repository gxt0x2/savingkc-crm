import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function verifyCasey() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('CASEY DAVIS PROFILE CHECK')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const { data, error } = await supabase
    .from('agent_profiles')
    .select('*')
    .eq('email', 'casey@savingkc.com')
    .single()

  if (error) {
    console.error('❌ Error fetching Casey profile:', error)
    return
  }

  if (!data) {
    console.error('❌ Casey profile not found')
    return
  }

  console.log('✅ Profile found!\n')
  console.log('Name:', data.full_name)
  console.log('Email:', data.email)
  console.log('Role:', data.role)
  console.log('Phone:', data.phone || 'Not set')
  console.log('Assigned Twilio:', data.assigned_twilio_number || 'Not set')
  console.log('')

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('UPLOAD FIELDS:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  const hasPhotoColumn = data.hasOwnProperty('profile_photo_url')
  const hasVoicemailColumn = data.hasOwnProperty('voicemail_recording_url')

  console.log('Profile Photo URL column:', hasPhotoColumn ? '✅ EXISTS' : '❌ MISSING')
  console.log('  Value:', data.profile_photo_url ? 'Photo saved' : 'Empty (ready for upload)')
  console.log('')
  console.log('Voicemail Recording URL column:', hasVoicemailColumn ? '✅ EXISTS' : '❌ MISSING')
  console.log('  Value:', data.voicemail_recording_url ? 'Recording saved' : 'Empty (ready for upload)')
  console.log('')

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('SUMMARY:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  if (hasPhotoColumn && hasVoicemailColumn) {
    console.log('✅ Casey profile is READY!')
    console.log('')
    console.log('Casey can:')
    console.log('  1. Log in with casey@savingkc.com')
    console.log('  2. Go to Settings')
    console.log('  3. Upload profile photo')
    console.log('  4. Upload voicemail recording')
    console.log('  5. Click "Save Settings"')
    console.log('  6. Page will reload with photo in header')
  } else {
    console.log('❌ Missing columns - needs database fix')
  }
  console.log('')
}

verifyCasey()
