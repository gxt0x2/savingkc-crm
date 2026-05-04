import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'




export async function POST(req: Request) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const results: string[] = []

  // Create push_subscriptions table
  const { error: pushErr } = await supabase.from('push_subscriptions').select('id').limit(1)
  if (pushErr && pushErr.code === 'PGRST205') {
    // Table doesn't exist — create it via insert/upsert won't work for DDL
    // Use supabase.rpc if available, otherwise log that manual creation is needed
    results.push('push_subscriptions: table needs manual creation via Supabase SQL editor')
  } else if (pushErr) {
    results.push(`push_subscriptions: error - ${pushErr.message}`)
  } else {
    results.push('push_subscriptions: exists')
  }

  // Create system_config table
  const { error: sysErr } = await supabase.from('system_config').select('key').limit(1)
  if (sysErr && sysErr.code === 'PGRST205') {
    results.push('system_config: table needs manual creation via Supabase SQL editor')
  } else if (sysErr) {
    results.push(`system_config: error - ${sysErr.message}`)
  } else {
    results.push('system_config: exists')

    // Seed default config entries (insert only if not present)
    const defaults = [
      { key: 'last_mojo_sync_timestamp', value: new Date(0).toISOString() },
      { key: 'mojo_thank_you_enabled', value: 'true' },
      { key: 'mojo_thank_you_dispositions', value: JSON.stringify(['appointment_set', 'meaningful_conversation', 'callback_scheduled', 'voicemail_left']) },
      { key: 'casey_company_number', value: '+18167277667' },
    ]

    for (const entry of defaults) {
      const { data: existing } = await supabase
        .from('system_config')
        .select('key')
        .eq('key', entry.key)
        .single()

      if (!existing) {
        const { error: insertErr } = await supabase
          .from('system_config')
          .insert({ key: entry.key, value: entry.value, updated_at: new Date().toISOString() })
        results.push(`system_config[${entry.key}]: ${insertErr ? 'error - ' + insertErr.message : 'seeded'}`)
      } else {
        results.push(`system_config[${entry.key}]: already exists`)
      }
    }
  }

  return NextResponse.json({ results })
}
