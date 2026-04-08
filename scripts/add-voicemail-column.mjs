import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function addColumn() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('ADDING VOICEMAIL_RECORDING_URL COLUMN')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const sql = `
    ALTER TABLE agent_profiles
    ADD COLUMN IF NOT EXISTS voicemail_recording_url TEXT;
  `

  console.log('Running SQL:', sql)
  console.log('')

  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql })

  if (error) {
    console.error('❌ Error:', error)
    console.log('\n⚠️  Need to run this SQL manually in Supabase dashboard:')
    console.log('')
    console.log(sql)
    console.log('')
    console.log('Go to: https://supabase.com/dashboard/project/fprrknfyzlthbxewnwmi/editor')
    return
  }

  console.log('✅ Column added successfully!')
  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ DONE - Now you can save voicemail recordings!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

addColumn()
