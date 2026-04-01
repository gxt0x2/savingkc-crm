import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Settings stored in a simple key-value table
// Uses upsert on key='crm_settings' for the single-tenant CRM

async function ensureTable() {
  // Create table if it doesn't exist (runs via service role)
  try {
    await supabase.rpc('exec', {
      query: `CREATE TABLE IF NOT EXISTS crm_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`
    })
  } catch {
    // RPC might not exist — table may already exist or need manual creation
  }
}

let tableChecked = false

export async function GET() {
  try {
    if (!tableChecked) {
      await ensureTable()
      tableChecked = true
    }

    const { data, error } = await supabase
      .from('crm_settings')
      .select('value')
      .eq('key', 'agent_profile')
      .single()

    if (error && error.code === '42P01') {
      // Table doesn't exist — fall back gracefully
      return NextResponse.json({ settings: null })
    }

    if (data?.value) {
      return NextResponse.json({ settings: data.value })
    }
    return NextResponse.json({ settings: null })
  } catch {
    return NextResponse.json({ settings: null })
  }
}

export async function POST(req: Request) {
  try {
    const settings = await req.json()

    const { error } = await supabase
      .from('crm_settings')
      .upsert(
        { key: 'agent_profile', value: settings, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )

    if (error) {
      console.error('Settings save error:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Settings POST error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
