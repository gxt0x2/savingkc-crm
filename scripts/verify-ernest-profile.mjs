import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function verifyProfile() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('ERNEST PROFILE VERIFICATION')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const { data, error } = await supabase
    .from('agent_profiles')
    .select('*')
    .eq('email', '0gw2p3l0w@znx.jsi4')
    .single()

  if (error) {
    console.error('❌ Error fetching profile:', error)
    return
  }

  if (!data) {
    console.error('❌ Profile not found')
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
  console.log('PROFILE PHOTO:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  if (data.profile_photo_url) {
    console.log('✅ Photo saved!')
    console.log('   Type:', data.profile_photo_url.substring(0, 20))
    console.log('   Size:', data.profile_photo_url.length, 'characters')
    console.log('   Preview:', data.profile_photo_url.substring(0, 100) + '...')
  } else {
    console.log('❌ No photo saved')
  }
  console.log('')

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('VOICEMAIL:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Greeting Text:', data.voicemail_greeting || 'Not set')
  console.log('')
  if (data.voicemail_recording_url) {
    console.log('✅ Recording saved!')
    console.log('   Type:', data.voicemail_recording_url.substring(0, 20))
    console.log('   Size:', data.voicemail_recording_url.length, 'characters')
    console.log('   Preview:', data.voicemail_recording_url.substring(0, 100) + '...')
  } else {
    console.log('❌ No recording saved')
  }
  console.log('')

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('OTHER SETTINGS:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('After-hours behavior:', data.after_hours_behavior || 'Not set')
  console.log('Office hours enabled:', data.office_hours?.enabled ? 'Yes' : 'No')
  if (data.office_hours?.enabled) {
    console.log('  Start:', data.office_hours.start)
    console.log('  End:', data.office_hours.end)
    console.log('  Timezone:', data.office_hours.timezone)
  }
  console.log('')
  console.log('Notification preferences:', JSON.stringify(data.notification_prefs, null, 2))
  console.log('')

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('SUMMARY:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  const photoStatus = data.profile_photo_url ? '✅ Saved' : '❌ Missing'
  const voicemailStatus = data.voicemail_recording_url ? '✅ Saved' : '❌ Missing'
  console.log('Profile Photo:', photoStatus)
  console.log('Voicemail Recording:', voicemailStatus)
  console.log('')

  if (data.profile_photo_url && data.voicemail_recording_url) {
    console.log('✅ ALL UPLOADS SAVED SUCCESSFULLY!')
    console.log('')
    console.log('Where they are used:')
    console.log('  • Profile photo: Header avatar (top-right corner)')
    console.log('  • Profile photo: Settings page')
    console.log('  • Profile photo: Activity feed (your actions)')
    console.log('  • Voicemail: Twilio voicemail system (after-hours calls)')
    console.log('  • Voicemail: Missed call handling')
  } else {
    console.log('⚠️  Some uploads missing - did save fail?')
  }
  console.log('')
}

verifyProfile()
