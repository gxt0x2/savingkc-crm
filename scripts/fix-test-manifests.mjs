#!/usr/bin/env node
/**
 * Fix test manifests - create manifests for test leads
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log('🔧 Fixing test lead manifests...\n')

// Lead IDs from tests
const testLeads = [
  '0d5ab7f0-fbee-482b-b714-0c4aed565196', // Ernest (Wyatt booking)
  '98731c01-6cb8-40c4-a161-4b538762e25e', // Ernest Dodson (appointment modal test)
]

for (const leadId of testLeads) {
  // Get lead details
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead) {
    console.log(`❌ Lead ${leadId} not found`)
    continue
  }

  console.log(`📋 ${lead.full_name} (${lead.phone})`)

  // Check if manifest exists
  const { data: existing } = await supabase
    .from('manifests')
    .select('id')
    .eq('lead_id', leadId)
    .single()

  if (existing) {
    console.log(`   ✅ Manifest already exists`)
    continue
  }

  // Create manifest using buildManifest
  const nameParts = (lead.full_name || 'Unknown').split(' ')

  // Inline buildManifest logic (simplified)
  const manifest = {
    version: '2.0',
    owner: {
      firstName: nameParts[0] || 'Unknown',
      lastName: nameParts.slice(1).join(' ') || '',
      phone: lead.phone || '',
      email: lead.email || '',
      deceased: false,
    },
    property: {
      address: lead.property_address || '',
      city: lead.city || '',
      state: lead.state || '',
      zip: lead.zip || '',
    },
    situation: {
      type: [],
      motivation: {},
    },
    pipeline: {
      qualifying: { status: 'pending' },
      discovery: { status: 'pending' },
      research: { status: 'pending' },
      valuation: { status: 'pending' },
      offer: { status: 'pending' },
      negotiations: { status: 'pending' },
      contract: { status: 'pending' },
      inspection: { status: 'pending' },
      closing_prep: { status: 'pending' },
      closing: { status: 'pending' },
      closed: { status: 'pending' },
    },
    flags: {},
    notes: [],
    communications: { smsLog: [], emailLog: [], callLog: [] },
    agentNotes: [],
    auditTrail: [],
    source: lead.source || 'website_form',
    currentStation: lead.station || 'intake',
    priority: lead.priority || 'warm',
    tier: 'standard',
    qualificationScore: 0,
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    lastUpdatedBy: 'script:fix_test_manifests',
  }

  const { data: inserted, error } = await supabase
    .from('manifests')
    .insert({
      lead_id: leadId,
      manifest,
      current_station: manifest.currentStation,
      priority: manifest.priority,
      tier: manifest.tier,
      qualification_score: manifest.qualificationScore,
    })
    .select('id')
    .single()

  if (error) {
    console.log(`   ❌ Failed:`, error.message)
  } else {
    console.log(`   ✅ Manifest created: ${inserted.id}`)
  }
}

console.log('\n✅ Done')
