#!/usr/bin/env node
/**
 * Fix phone number formatting in lead names
 * Updates names like "Caller (+19137179716)" to "Caller (913) 717-9716"
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function formatPhone(phone) {
  if (!phone) return ''

  // Strip all non-digits
  const digits = phone.replace(/\D/g, '')

  // Handle 10-digit numbers
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }

  // Handle 11-digit numbers starting with 1 (US country code)
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }

  // Return original if can't format
  return phone
}

async function fixLeadNames() {
  console.log('🔍 Finding leads with unformatted phone numbers in names...\n')

  // Patterns to match: "Caller (+1...)", "Missed Call (+1...)", "SMS Lead (+1...)", etc.
  const patterns = [
    'Caller (+%',
    'Missed Call (+%',
    'SMS Lead (+%',
    'Voicemail Caller (+%',
    'Cold Callback (+%'
  ]

  let totalUpdated = 0

  for (const pattern of patterns) {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, full_name, phone')
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
      // Extract the phone from the name using regex
      const match = lead.full_name.match(/\(\+1?(\d+)\)/)
      if (!match) {
        console.log(`  ⚠️  Could not extract phone from: ${lead.full_name}`)
        continue
      }

      const rawPhone = match[1]
      const formattedPhone = formatPhone(rawPhone)

      // Determine the prefix (Caller, Missed Call, etc.)
      const prefix = lead.full_name.split('(')[0].trim()
      const newName = `${prefix} ${formattedPhone}`

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

fixLeadNames().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
