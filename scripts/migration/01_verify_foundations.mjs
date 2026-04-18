#!/usr/bin/env node
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync(process.env.HOME + '/savingkc-crm/.env.local', 'utf-8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim()
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim()
const supabase = createClient(url, key, { auth: { persistSession: false } })

// State probe: can we see the new table + column?
const checks = {
  manifest_history_readable: await supabase.from('manifest_history').select('id').limit(1).then(r => !r.error, () => false),
  is_hot_eligible_queryable: await supabase.from('manifests').select('id, is_hot_eligible').limit(1).then(r => !r.error, () => false),
}

// Try calling the function with a non-existent manifest — should raise a clean
// "Manifest not found" error, which proves the function is callable and wired.
const { data, error } = await supabase.rpc('update_manifest_and_cascade', {
  p_manifest_id: '00000000-0000-4000-8000-000000000000',
  p_subtrees: {},
  p_actor: 'verification_probe',
  p_reason: 'does this function exist and respond correctly',
})

checks.function_callable = !!error && /not found/i.test(error.message)
checks.function_error_msg = error?.message ?? '(no error — unexpected)'

console.log(JSON.stringify(checks, null, 2))
