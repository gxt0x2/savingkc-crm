// Quick script to enrich Sharon Cobbins property
// Run with: node scripts/enrich-sharon.js

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function enrichSharon() {
  console.log('Finding Sharon Cobbins lead...')

  const { data: leads } = await supabase
    .from('leads')
    .select('id, full_name, address, city, state, zip')
    .ilike('full_name', '%sharon%cobbins%')
    .limit(1)

  if (!leads || leads.length === 0) {
    console.log('Sharon Cobbins not found. Creating sample lead...')

    const { data: newLead, error } = await supabase
      .from('leads')
      .insert({
        full_name: 'Sharon Cobbins',
        phone: '(816) 882-8221',
        address: '5621 W 151st Ter',
        city: 'Overland Park',
        state: 'KS',
        zip: '66223',
        source: 'manual',
        station: 'intake'
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating lead:', error)
      return
    }

    console.log('Created lead:', newLead.id)
    console.log('Now trigger enrichment from the UI or run: npm run enrich', newLead.id)
    return
  }

  const lead = leads[0]
  console.log('Found lead:', lead.id, lead.full_name)
  console.log('Address:', lead.address, lead.city, lead.state, lead.zip)
  console.log('\nTo enrich this property:')
  console.log('1. Open the lead in the CRM')
  console.log('2. Click the "Enrich" button')
  console.log('3. Or run: curl -X POST http://localhost:3000/api/enrich -d \'{"leadId":"' + lead.id + '"}\'')
}

enrichSharon().catch(console.error)
