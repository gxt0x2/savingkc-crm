#!/usr/bin/env node
/**
 * Synthetic end-to-end test of the complete Mojo → CRM pipeline.
 * Simulates a real Mojo sync with David Oglesby's actual data,
 * then verifies every field made it through.
 */

import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const envFile = fs.readFileSync('/Users/ernestdodson/savingkc-crm/.env.local', 'utf8')
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=:#]+)=(.*)$/)
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '')
})

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const CRM_URL = 'http://localhost:3002'
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET || process.env.CRON_SECRET || process.env.DEPLOY_SECRET || ''

const PASS = '✓'
const FAIL = '✗'
let passed = 0
let failed = 0
const failures = []

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ${PASS} ${label}`)
    passed++
  } else {
    console.log(`  ${FAIL} ${label} — ${detail || 'FAILED'}`)
    failed++
    failures.push(label)
  }
}

async function cleanup(leadId) {
  if (!leadId) return
  await supabase.from('manifests').delete().eq('lead_id', leadId)
  await supabase.from('bookings').delete().eq('lead_id', leadId)
  await supabase.from('leads').delete().eq('id', leadId)
}

async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log(' SYNTHETIC END-TO-END MOJO → CRM PIPELINE TEST')
  console.log('═══════════════════════════════════════════════════════\n')

  // Create a synthetic Mojo call record with ALL fields populated
  // This simulates what mojo-sync.mjs would produce after our fixes
  const syntheticCall = {
    record_id: `synthetic-test-${Date.now()}`,
    contact_name: 'SYNTHETIC TEST SELLER',
    phone_number: '+15550001234',
    property_address: '8525 MAYWOOD AVE',
    city: 'Raytown',
    state: 'MO',
    zip: '64138',
    call_date: new Date().toISOString(),
    call_duration: 1366, // 22:46
    disposition: 'Callback Requested',
    agent_name: 'Casey Davis',
    notes: 'Timeline: 30-60 days, wants to sell before summer\nCondition: Good shape overall, needs new HVAC\nPrice: 150k but flexible down to 120k\nMotivation: Relocating for new job, needs to sell quickly',
    list_name: 'Jackson County Tax Delinquent',
    campaign_name: 'Spring 2026',
    recording_url: 'https://app71.mojosells.com/rest/reports/call-recording-get-audio?record_id=99999999',
    follow_up_date: '2026-04-10T14:00:00-05:00',
    email: 'synthetic-test@example.com',
  }

  let leadId = null

  try {
    // ═══════════════════════════════════════════════════════
    console.log('PHASE 1: Submit to /api/mojo/sync')
    console.log('─────────────────────────────────────────')

    const syncRes = await fetch(`${CRM_URL}/api/mojo/sync`, {
      method: 'POST',
      headers: ADMIN_API_SECRET
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_API_SECRET}` }
        : { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calls: [syntheticCall] }),
    })

    const syncResult = await syncRes.json()
    console.log(`  Response: ${JSON.stringify(syncResult)}\n`)

    check('Sync returned OK', syncRes.ok, `HTTP ${syncRes.status}`)
    check('Processed 1 call', syncResult.processed >= 1 || syncResult.created >= 1, `processed=${syncResult.processed}, created=${syncResult.created}`)

    // Find the created lead
    const { data: leads } = await supabase
      .from('leads')
      .select('id, full_name, phone, email, property_address, city, state, zip, county, station, appointment_date')
      .eq('phone', '+15550001234')
      .order('created_at', { ascending: false })
      .limit(1)

    check('Lead created in DB', leads && leads.length > 0, 'No lead found')

    if (!leads || leads.length === 0) {
      console.log('\n✗ CANNOT CONTINUE — No lead created')
      return
    }

    const lead = leads[0]
    leadId = lead.id
    console.log(`\n  Lead ID: ${leadId}\n`)

    // ═══════════════════════════════════════════════════════
    console.log('PHASE 2: Verify lead fields')
    console.log('─────────────────────────────────────────')

    check('Full name', lead.full_name === 'SYNTHETIC TEST SELLER', `got "${lead.full_name}"`)
    check('Phone', lead.phone === '+15550001234', `got "${lead.phone}"`)
    check('Email', lead.email === 'synthetic-test@example.com', `got "${lead.email}"`)
    check('Property address', lead.property_address === '8525 MAYWOOD AVE', `got "${lead.property_address}"`)
    check('City', lead.city === 'Raytown', `got "${lead.city}"`)
    check('State', lead.state === 'MO', `got "${lead.state}"`)
    check('Zip', lead.zip === '64138', `got "${lead.zip}"`)
    check('Station is qualifying', lead.station === 'qualifying', `got "${lead.station}"`)
    check('Appointment date set', !!lead.appointment_date, `got "${lead.appointment_date}"`)

    // ═══════════════════════════════════════════════════════
    console.log('\nPHASE 3: Verify manifest')
    console.log('─────────────────────────────────────────')

    const { data: manifestRow } = await supabase
      .from('manifests')
      .select('manifest')
      .eq('lead_id', leadId)
      .single()

    check('Manifest exists', !!manifestRow, 'No manifest found')

    if (!manifestRow) {
      console.log('\n✗ CANNOT CONTINUE — No manifest')
      return
    }

    const m = manifestRow.manifest

    // Agent notes
    const hasAgentNote = m.agentNotes?.some(n => n.content?.includes('Timeline: 30-60 days'))
    check('Agent notes contain Casey\'s intel', hasAgentNote, 'Notes not found in agentNotes[]')

    // Seller intel extracted from notes
    check('Timeline extracted', !!m.situation?.timeline, 'situation.timeline missing')
    check('Timeline urgency', m.situation?.timeline?.urgency === 'medium', `got "${m.situation?.timeline?.urgency}"`)

    check('Price expectations extracted', !!m.situation?.priceExpectations, 'priceExpectations missing')
    check('Seller asking price', m.situation?.priceExpectations?.sellerAsking === 150000, `got ${m.situation?.priceExpectations?.sellerAsking}`)
    check('Seller floor price', m.situation?.priceExpectations?.sellerFloor === 120000, `got ${m.situation?.priceExpectations?.sellerFloor}`)

    check('Motivation extracted', !!(m.situation?.motivation)?.notes, 'motivation.notes missing')
    check('Condition extracted', !!m.property?.condition?.notes, 'condition.notes missing')

    // Follow-up
    check('Follow-up in timeline', !!m.situation?.timeline?.targetCloseDate, 'targetCloseDate missing')
    const hasFollowUpAction = m.ariIntelligence?.recommendedActions?.some(a => a.action?.includes('Follow-up'))
    check('Follow-up in recommended actions', hasFollowUpAction, 'No follow-up action found')

    // Recording URL in transcript
    const hasRecording = m.communications?.transcripts?.some(t => t.recordingUrl?.includes('99999999'))
    check('Recording URL stored', hasRecording, `transcripts: ${JSON.stringify(m.communications?.transcripts?.map(t => t.recordingUrl?.substring(0, 50)))}`)

    // Audit trail
    const hasNoteIntel = m.auditTrail?.some(e => e.action === 'seller_intel_extracted_from_notes')
    check('Audit: seller_intel_extracted_from_notes', hasNoteIntel, 'Missing audit event')

    // ═══════════════════════════════════════════════════════
    console.log('\nPHASE 4: Verify enrichment triggers')
    console.log('─────────────────────────────────────────')

    // Wait for async enrichment
    console.log('  Waiting 45s for enrichment...')
    await new Promise(r => setTimeout(r, 45000))

    const { data: enrichedManifest } = await supabase
      .from('manifests')
      .select('manifest')
      .eq('lead_id', leadId)
      .single()

    const em = enrichedManifest?.manifest

    // Check if enrichment ran
    const hasProspectEnrich = em?.auditTrail?.some(e =>
      e.action === 'prospect_enrichment_complete' || e.action === 'enriched_from_prospect' || e.agent?.includes('prospect')
    )
    const hasCountyEnrich = em?.auditTrail?.some(e =>
      e.action === 'county_enrichment_complete' || e.agent?.includes('county')
    )

    check('Auto-enrichment triggered', em?.auditTrail?.length > (m.auditTrail?.length || 0), `trail length: ${em?.auditTrail?.length} vs ${m.auditTrail?.length}`)
    check('Prospect enrichment recorded', hasProspectEnrich, 'No prospect enrichment audit event')
    check('County enrichment recorded', hasCountyEnrich, 'No county enrichment audit event')

    // Property data from enrichment
    const hasDwelling = em?.property?.dwelling?.sqft || em?.property?.dwelling?.yearBuilt
    const hasAssessment = em?.property?.assessment?.totalValue
    const hasParcel = !!em?.property?.parcel

    check('Parcel ID populated', hasParcel, `got "${em?.property?.parcel}"`)

    if (hasDwelling) {
      check('Dwelling data (sqft/yearBuilt)', true)
      console.log(`    sqft=${em.property.dwelling.sqft}, yearBuilt=${em.property.dwelling.yearBuilt}`)
    } else {
      check('Dwelling data (sqft/yearBuilt)', false, 'No dwelling data from county scraper')
    }

    if (hasAssessment) {
      check('Assessment value', true)
      console.log(`    totalValue=$${em.property.assessment.totalValue?.toLocaleString()}`)
    } else {
      check('Assessment value', false, 'No assessment from county scraper')
    }

    // ═══════════════════════════════════════════════════════
    console.log('\nPHASE 5: Check server logs for errors')
    console.log('─────────────────────────────────────────')

    const stderr = fs.readFileSync('/Users/ernestdodson/savingkc-crm/logs/stderr.log', 'utf8')
    const recentErrors = stderr.split('\n')
      .filter(l => l.includes('Error') || l.includes('error') || l.includes('FAIL') || l.includes('fail'))
      .slice(-10)

    if (recentErrors.length > 0) {
      console.log('  Recent errors in stderr:')
      recentErrors.forEach(e => console.log(`    ${e.substring(0, 120)}`))
    } else {
      console.log('  No recent errors in stderr')
    }

    // Check stdout for sync-specific logs
    const stdout = fs.readFileSync('/Users/ernestdodson/savingkc-crm/logs/stdout.log', 'utf8')
    const syncLogs = stdout.split('\n')
      .filter(l => l.includes('[mojo/sync]') || l.includes('auto-enrich') || l.includes('MISSING'))
      .slice(-15)

    if (syncLogs.length > 0) {
      console.log('\n  Sync-related logs:')
      syncLogs.forEach(l => console.log(`    ${l.substring(0, 150)}`))
    }

  } finally {
    // ═══════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════')
    console.log(` RESULTS: ${passed} passed, ${failed} failed`)
    console.log('═══════════════════════════════════════════════════════')

    if (failures.length > 0) {
      console.log('\nFailures:')
      failures.forEach(f => console.log(`  ${FAIL} ${f}`))
    }

    // Cleanup synthetic test data
    if (leadId) {
      console.log(`\nCleaning up test lead ${leadId}...`)
      await cleanup(leadId)
      console.log('✓ Cleaned up')
    }

    console.log(`\n${failed === 0 ? '🎉 ALL TESTS PASSED!' : `⚠️  ${failed} TEST(S) FAILED`}`)
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
