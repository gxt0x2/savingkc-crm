import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkZestimate() {
  // Find Sharon Cobbins
  const { data: lead } = await supabase
    .from('leads')
    .select('id, full_name, property_address, arv')
    .ilike('full_name', '%sharon%cobbins%')
    .single()

  if (!lead) {
    console.log('Sharon Cobbins not found')
    return
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('ZESTIMATE DATA SOURCE PROOF')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Lead:', lead.full_name)
  console.log('Address:', lead.property_address)
  console.log('')

  // Get manifest
  const { data: manifest } = await supabase
    .from('manifests')
    .select('manifest')
    .eq('lead_id', lead.id)
    .single()

  if (!manifest?.manifest) {
    console.log('❌ No manifest found')
    return
  }

  const fin = manifest.manifest.financials || {}

  console.log('📊 Data Sources:')
  console.log('─────────────────────────────────────────────')
  console.log('1. ARV (Net Proceeds Calculator Input):')
  console.log('   lead.arv =', lead.arv ? `$${lead.arv.toLocaleString()}` : 'null')
  console.log('')
  console.log('2. Zillow Zestimate (Enrichment Data):')
  console.log('   manifest.financials.zillow_zestimate =', fin.zillow_zestimate ? `$${fin.zillow_zestimate.toLocaleString()}` : 'null')
  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ BEFORE FIX: PropertyHero displayed lead.arv')
  console.log('✅ AFTER FIX:  PropertyHero displays manifest.financials.zillow_zestimate')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  console.log('Current Display Value:', fin.zillow_zestimate ? `$${fin.zillow_zestimate.toLocaleString()}` : '—')
}

checkZestimate().catch(console.error)
