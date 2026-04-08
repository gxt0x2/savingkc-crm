#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('\n🔍 Finding duplicate manifests...\n')

// Find all lead_ids that have multiple manifests
const { data: duplicates, error: findError } = await supabase
  .from('manifests')
  .select('lead_id, id, created_at, manifest')
  .order('lead_id')
  .order('created_at')

if (findError) {
  console.error('❌ Error finding duplicates:', findError)
  process.exit(1)
}

// Group by lead_id
const grouped = {}
for (const row of duplicates) {
  if (!grouped[row.lead_id]) {
    grouped[row.lead_id] = []
  }
  grouped[row.lead_id].push(row)
}

// Find lead_ids with duplicates
const dupeLeadIds = Object.keys(grouped).filter(leadId => grouped[leadId].length > 1)

console.log(`Found ${dupeLeadIds.length} leads with duplicate manifests\n`)

let totalDeleted = 0

for (const leadId of dupeLeadIds) {
  const manifests = grouped[leadId]
  console.log(`\n📋 Lead ${leadId.substring(0, 8)}... has ${manifests.length} manifests:`)

  // Rank manifests - prefer ones with more data
  const ranked = manifests.map((m, idx) => {
    const hasAppointment = m.manifest?.pipeline?.appointment ? 1000 : 0
    const hasTranscripts = m.manifest?.communications?.transcripts?.length || 0
    const hasNotes = m.manifest?.notes?.length || 0
    const hasActivities = m.manifest?.agentNotes?.length || 0
    const isNewer = manifests.length - idx // Newer = higher score

    const score = hasAppointment + (hasTranscripts * 100) + (hasNotes * 10) + (hasActivities * 10) + isNewer

    return { ...m, score }
  })

  ranked.sort((a, b) => b.score - a.score)

  // Keep the best one (highest score), delete the rest
  const toKeep = ranked[0]
  const toDelete = ranked.slice(1)

  console.log(`   ✅ Keeping: ${toKeep.id} (score: ${toKeep.score}, created: ${new Date(toKeep.created_at).toLocaleTimeString()})`)

  for (const dup of toDelete) {
    console.log(`   ❌ Deleting: ${dup.id} (score: ${dup.score}, created: ${new Date(dup.created_at).toLocaleTimeString()})`)

    const { error: deleteError } = await supabase
      .from('manifests')
      .delete()
      .eq('id', dup.id)

    if (deleteError) {
      console.error(`      Error deleting: ${deleteError.message}`)
    } else {
      totalDeleted++
    }
  }
}

console.log(`\n✅ Cleanup complete! Deleted ${totalDeleted} duplicate manifests.\n`)

// Now try to add the constraint
console.log('🔧 Adding unique constraint...\n')

const { error: constraintError } = await supabase.rpc('exec_sql', {
  sql: 'CREATE UNIQUE INDEX IF NOT EXISTS manifests_lead_id_unique ON manifests(lead_id);'
})

if (constraintError) {
  console.error('❌ Failed to add constraint:', constraintError.message)
  process.exit(1)
}

console.log('✅ Unique constraint added successfully!')
console.log('   Index: manifests_lead_id_unique')
console.log('   Column: lead_id\n')
