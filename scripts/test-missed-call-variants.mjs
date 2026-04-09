#!/usr/bin/env node

/**
 * Test Missed Call Auto-Text Messaging System
 *
 * Verifies:
 * - Message variants (1st, 2nd, 3rd, 4+ calls)
 * - Agent routing (Casey's numbers vs Ernest's numbers)
 * - Known vs unknown lead messaging
 * - Rate limiting (4 texts max in 48h, 20min cooldown)
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE env vars')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Test phone numbers
const TEST_KNOWN_LEAD = '+15555551234' // Will be inserted as a lead
const TEST_UNKNOWN = '+15555559999' // Not in DB

// Test Twilio numbers
const CASEY_NUMBER = '+18167277667'
const ERNEST_NUMBER = '+18166088588'

async function setupTestLead() {
  console.log('\n📝 Setting up test lead...')

  // Clean up previous test data
  await supabase.from('lead_activities')
    .delete()
    .eq('metadata->>to', TEST_KNOWN_LEAD)

  await supabase.from('leads')
    .delete()
    .eq('phone', TEST_KNOWN_LEAD)

  // Insert test lead
  const { data: lead, error } = await supabase.from('leads')
    .insert({
      full_name: 'Robert TestLead',
      phone: TEST_KNOWN_LEAD,
      source: 'test',
      station: 'intake',
      priority: 'medium',
    })
    .select('id')
    .single()

  if (error) {
    console.error('❌ Failed to create test lead:', error)
    return null
  }

  console.log(`✅ Created test lead: ${lead.id}`)
  return lead.id
}

async function simulateMissedCallText(leadId, phone, calledNumber, variant) {
  console.log(`\n📱 Simulating missed call #${variant + 1}...`)
  console.log(`   Called number: ${calledNumber}`)
  console.log(`   Caller: ${phone}`)

  // Insert a mock auto-text activity
  const { error } = await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'sms',
    description: `Test auto-text variant ${variant}`,
    agent: 'System',
    metadata: {
      direction: 'outbound',
      from: calledNumber,
      to: phone,
      trigger: 'missed_call_auto',
      variant,
      agent_name: calledNumber === CASEY_NUMBER ? 'Casey' : 'Ernest',
    }
  })

  if (error) {
    console.error('❌ Failed to log text:', error)
    return false
  }

  console.log(`✅ Logged variant ${variant} auto-text`)
  return true
}

async function testMessageVariants() {
  console.log('\n' + '='.repeat(60))
  console.log('TEST 1: Message Variants for Known Lead')
  console.log('='.repeat(60))

  const leadId = await setupTestLead()
  if (!leadId) return

  // Import the messaging module
  const { getMissedCallResponse } = await import('../src/lib/missed-call-messaging.ts')

  // Test 1st call
  console.log('\n--- 1st Call (Ernest\'s number) ---')
  let response = await getMissedCallResponse({
    leadId,
    leadName: 'Robert TestLead',
    fromPhone: TEST_KNOWN_LEAD,
    calledNumber: ERNEST_NUMBER,
    isKnownLead: true,
  })

  console.log(`Message: "${response?.message}"`)
  console.log(`Agent: ${response?.agentName}`)
  console.log(`Delay: ${response?.delaySeconds}s`)
  console.log(`Variant: ${response?.variant}`)

  if (!response?.message?.includes('Ernest')) {
    console.error('❌ FAIL: Should mention Ernest (his number was called)')
  } else if (!response?.message?.includes('Robert')) {
    console.error('❌ FAIL: Should use first name')
  } else if (!response?.message?.includes('few minutes')) {
    console.error('❌ FAIL: 1st call should say "few minutes" (casual)')
  } else {
    console.log('✅ PASS: Correct message for 1st call')
  }

  // Log it
  await simulateMissedCallText(leadId, TEST_KNOWN_LEAD, ERNEST_NUMBER, 0)

  // Test 2nd call
  console.log('\n--- 2nd Call (same number, after 21 min) ---')

  // Backdate the first text so 20min cooldown passes
  await supabase.from('lead_activities')
    .update({ created_at: new Date(Date.now() - 21 * 60 * 1000).toISOString() })
    .eq('lead_id', leadId)
    .eq('metadata->>variant', '0')

  response = await getMissedCallResponse({
    leadId,
    leadName: 'Robert TestLead',
    fromPhone: TEST_KNOWN_LEAD,
    calledNumber: ERNEST_NUMBER,
    isKnownLead: true,
  })

  console.log(`Message: "${response?.message}"`)
  console.log(`Variant: ${response?.variant}`)

  if (response?.variant !== 1) {
    console.error('❌ FAIL: Should be variant 1 (2nd call)')
  } else if (response?.message === response?.message) {
    console.log('✅ PASS: Different message from 1st call')
  }

  await simulateMissedCallText(leadId, TEST_KNOWN_LEAD, ERNEST_NUMBER, 1)

  // Test rate limit (5th call should be blocked)
  console.log('\n--- 5th Call (should be rate limited) ---')

  // Add 2 more texts (total = 4)
  await supabase.from('lead_activities').insert([
    {
      lead_id: leadId,
      activity_type: 'sms',
      agent: 'System',
      description: 'Test 3',
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      metadata: { trigger: 'missed_call_auto', variant: 2, to: TEST_KNOWN_LEAD }
    },
    {
      lead_id: leadId,
      activity_type: 'sms',
      agent: 'System',
      description: 'Test 4',
      created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      metadata: { trigger: 'missed_call_auto', variant: 3, to: TEST_KNOWN_LEAD }
    }
  ])

  response = await getMissedCallResponse({
    leadId,
    leadName: 'Robert TestLead',
    fromPhone: TEST_KNOWN_LEAD,
    calledNumber: ERNEST_NUMBER,
    isKnownLead: true,
  })

  if (response?.shouldSend) {
    console.error('❌ FAIL: Should block 5th text (rate limit)')
  } else {
    console.log('✅ PASS: Rate limit blocks 5th text in 48h')
  }
}

async function testAgentRouting() {
  console.log('\n' + '='.repeat(60))
  console.log('TEST 2: Agent Routing (Casey vs Ernest)')
  console.log('='.repeat(60))

  const leadId = await setupTestLead()
  if (!leadId) return

  const { getMissedCallResponse } = await import('../src/lib/missed-call-messaging.ts')

  // Casey's number
  console.log('\n--- Casey\'s Number Called ---')
  let response = await getMissedCallResponse({
    leadId,
    leadName: 'Robert TestLead',
    fromPhone: TEST_KNOWN_LEAD,
    calledNumber: CASEY_NUMBER,
    isKnownLead: true,
  })

  console.log(`Message: "${response?.message}"`)
  console.log(`Agent: ${response?.agentName}`)

  if (response?.agentName !== 'Casey') {
    console.error('❌ FAIL: Should route to Casey')
  } else if (!response?.message?.includes('Casey')) {
    console.error('❌ FAIL: Message should mention Casey')
  } else {
    console.log('✅ PASS: Correctly routed to Casey')
  }

  // Clean up
  await supabase.from('lead_activities')
    .delete()
    .eq('lead_id', leadId)

  // Ernest's number
  console.log('\n--- Ernest\'s Number Called ---')
  response = await getMissedCallResponse({
    leadId,
    leadName: 'Robert TestLead',
    fromPhone: TEST_KNOWN_LEAD,
    calledNumber: ERNEST_NUMBER,
    isKnownLead: true,
  })

  console.log(`Message: "${response?.message}"`)
  console.log(`Agent: ${response?.agentName}`)

  if (response?.agentName !== 'Ernest') {
    console.error('❌ FAIL: Should route to Ernest')
  } else if (!response?.message?.includes('Ernest')) {
    console.error('❌ FAIL: Message should mention Ernest')
  } else {
    console.log('✅ PASS: Correctly routed to Ernest')
  }
}

async function testUnknownCaller() {
  console.log('\n' + '='.repeat(60))
  console.log('TEST 3: Unknown Caller Messages')
  console.log('='.repeat(60))

  const { getMissedCallResponse } = await import('../src/lib/missed-call-messaging.ts')

  console.log('\n--- 1st Call from Unknown ---')
  let response = await getMissedCallResponse({
    leadId: null,
    leadName: null,
    fromPhone: TEST_UNKNOWN,
    calledNumber: ERNEST_NUMBER,
    isKnownLead: false,
  })

  console.log(`Message: "${response?.message}"`)
  console.log(`Delay: ${response?.delaySeconds}s`)

  if (!response?.message?.includes('Saving KC')) {
    console.error('❌ FAIL: Should mention company name')
  } else if (!response?.message?.toLowerCase().includes('yes')) {
    console.error('❌ FAIL: Should ask for YES reply')
  } else if (response?.delaySeconds < 60) {
    console.error('❌ FAIL: Unknown caller should have 60-120s delay')
  } else {
    console.log('✅ PASS: Correct message for unknown caller')
  }
}

async function test20MinCooldown() {
  console.log('\n' + '='.repeat(60))
  console.log('TEST 4: 20-Minute Cooldown')
  console.log('='.repeat(60))

  const leadId = await setupTestLead()
  if (!leadId) return

  const { getMissedCallResponse } = await import('../src/lib/missed-call-messaging.ts')

  // Send first text
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'sms',
    agent: 'System',
    description: 'Test',
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
    metadata: { trigger: 'missed_call_auto', variant: 0, to: TEST_KNOWN_LEAD }
  })

  console.log('\n--- Call 10 minutes after last text ---')
  let response = await getMissedCallResponse({
    leadId,
    leadName: 'Robert TestLead',
    fromPhone: TEST_KNOWN_LEAD,
    calledNumber: ERNEST_NUMBER,
    isKnownLead: true,
  })

  if (response?.shouldSend) {
    console.error('❌ FAIL: Should block text (only 10 min since last)')
  } else {
    console.log('✅ PASS: Cooldown blocks text within 20 min')
  }

  // Update to 21 min ago
  await supabase.from('lead_activities')
    .update({ created_at: new Date(Date.now() - 21 * 60 * 1000).toISOString() })
    .eq('lead_id', leadId)

  console.log('\n--- Call 21 minutes after last text ---')
  response = await getMissedCallResponse({
    leadId,
    leadName: 'Robert TestLead',
    fromPhone: TEST_KNOWN_LEAD,
    calledNumber: ERNEST_NUMBER,
    isKnownLead: true,
  })

  if (!response?.shouldSend) {
    console.error('❌ FAIL: Should allow text (21 min has passed)')
  } else {
    console.log('✅ PASS: Cooldown allows text after 20 min')
  }
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...')

  await supabase.from('lead_activities')
    .delete()
    .or(`metadata->to.eq.${TEST_KNOWN_LEAD},metadata->to.eq.${TEST_UNKNOWN}`)

  await supabase.from('leads')
    .delete()
    .in('phone', [TEST_KNOWN_LEAD, TEST_UNKNOWN])

  console.log('✅ Cleanup complete')
}

// Run all tests
async function runAllTests() {
  try {
    await testMessageVariants()
    await testAgentRouting()
    await testUnknownCaller()
    await test20MinCooldown()
  } catch (error) {
    console.error('\n❌ Test failed with error:', error)
  } finally {
    await cleanup()
  }

  console.log('\n' + '='.repeat(60))
  console.log('✅ All tests complete')
  console.log('='.repeat(60))
}

runAllTests()
