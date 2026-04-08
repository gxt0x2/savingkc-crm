#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('\n🔧 Adding unique constraint to manifests.lead_id...\n')

const { data, error } = await supabase.rpc('exec_sql', {
  sql: 'CREATE UNIQUE INDEX IF NOT EXISTS manifests_lead_id_unique ON manifests(lead_id);'
})

if (error) {
  console.error('❌ Failed to add constraint:', error)
  process.exit(1)
}

console.log('✅ Unique constraint added successfully!')
console.log('   Index: manifests_lead_id_unique')
console.log('   Column: lead_id')
console.log('   Effect: Only 1 manifest per lead allowed at DB level\n')
