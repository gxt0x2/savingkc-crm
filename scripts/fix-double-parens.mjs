#!/usr/bin/env node
/**
 * Fix double parentheses in lead names
 * Updates names like "Caller ((816) 425-9217)" to "Caller (816) 425-9217"
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fixDoubleParens() {
  console.log('🔍 Finding leads with double parentheses...\n')

  // Patterns with double opening parentheses
  const patterns = [
    'Caller ((%',
    'Missed Call ((%',
    'SMS Lead ((%',
    'Voicemail Caller ((%',
    'Cold Callback ((%'
  ]

  let totalUpdated = 0

  for (const pattern of patterns) {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, full_name')
      .like('full_name', pattern)

    if (error) {
      console.error(`❌ Error fetching leads for pattern "${pattern}":`, error)
      continue
    }

    if (!leads || leads.length === 0) {
      console.log(`✓ No leads found matching "${pattern}"`)
      continue
    }

    console.log(`📋 Found ${leads.length} leads matching "${pattern}"`)

    for (const lead of leads) {
      // Replace (( with ( and remove trailing )
      let newName = lead.full_name.replace('((', '(')
      // Remove extra closing paren if it exists at the end
      if (newName.endsWith('))')) {
        newName = newName.slice(0, -1)
      }

      console.log(`  📝 Updating: "${lead.full_name}" → "${newName}"`)

      const { error: updateError } = await supabase
        .from('leads')
        .update({ full_name: newName })
        .eq('id', lead.id)

      if (updateError) {
        console.error(`  ❌ Error updating lead ${lead.id}:`, updateError)
      } else {
        totalUpdated++
      }
    }

    console.log('')
  }

  console.log(`\n✅ Complete! Updated ${totalUpdated} lead name${totalUpdated === 1 ? '' : 's'}.\n`)
}

fixDoubleParens().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
