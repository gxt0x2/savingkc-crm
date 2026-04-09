#!/usr/bin/env node
/**
 * Fix trailing parenthesis in lead names
 * Updates names like "Caller (816) 425-9217)" to "Caller (816) 425-9217"
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fixTrailingParen() {
  console.log('🔍 Finding leads with trailing parenthesis...\n')

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, full_name')
    .or('full_name.like.%),full_name.like.%))')

  if (error) {
    console.error('❌ Error fetching leads:', error)
    return
  }

  if (!leads || leads.length === 0) {
    console.log('✓ No leads found with trailing parenthesis')
    return
  }

  // Filter to only those that end with ) and have a phone pattern
  const leadsToFix = leads.filter(lead => {
    return lead.full_name.match(/\(\d{3}\)\s\d{3}-\d{4}\)$/)
  })

  if (leadsToFix.length === 0) {
    console.log('✓ No leads need fixing')
    return
  }

  console.log(`📋 Found ${leadsToFix.length} leads to fix\n`)

  let updated = 0

  for (const lead of leadsToFix) {
    // Remove the trailing )
    const newName = lead.full_name.slice(0, -1)

    console.log(`  📝 "${lead.full_name}" → "${newName}"`)

    const { error: updateError } = await supabase
      .from('leads')
      .update({ full_name: newName })
      .eq('id', lead.id)

    if (updateError) {
      console.error(`  ❌ Error:`, updateError)
    } else {
      updated++
    }
  }

  console.log(`\n✅ Updated ${updated} lead name${updated === 1 ? '' : 's'}.\n`)
}

fixTrailingParen().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
