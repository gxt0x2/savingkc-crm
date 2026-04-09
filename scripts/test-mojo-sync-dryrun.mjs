#!/usr/bin/env node
/**
 * Test the Mojo sync pipeline improvements:
 * 1. Contact details (address, phone) from /v2/rest/contacts/data/{id}/
 * 2. Call recordings from recording-report API
 * 3. Follow-up scheduling (activity type 6)
 */

import fs from 'fs'

const MOJO_BASE_URL = 'https://app71.mojosells.com'
const SESSION_FILE = '/Users/ernestdodson/.openclaw/workspace/memory/mojo-session.json'

function readSession() {
  const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))
  return session.expired ? null : session
}

function mojoHeaders(sessionId) {
  return {
    accept: 'application/json, text/plain, */*',
    cookie: `sessionid=${sessionId}`,
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    referer: `${MOJO_BASE_URL}/`,
  }
}

async function main() {
  const session = readSession()
  if (!session?.sessionId) { console.error('No session'); process.exit(1) }
  const sid = session.sessionId

  console.log('=== TEST MOJO SYNC IMPROVEMENTS ===\n')

  // Test 1: Contact details API (correct endpoint)
  console.log('1. Testing /v2/rest/contacts/data/3580/ (David Oglesby)...')
  const contactRes = await fetch(`${MOJO_BASE_URL}/v2/rest/contacts/data/3580/`, {
    headers: mojoHeaders(sid),
    signal: AbortSignal.timeout(10000),
  })
  const contentType = contactRes.headers.get('content-type') || ''
  console.log(`   Status: ${contactRes.status}, Content-Type: ${contentType}`)

  if (contentType.includes('json')) {
    const data = await contactRes.json()
    console.log(`   ✓ JSON response`)
    console.log(`   Name: ${data.full_name}`)
    console.log(`   Address: ${data.address}`)
    console.log(`   City: ${data.city}`)
    console.log(`   State: ${data.state}`)
    console.log(`   Zip: ${data.zip_code}`)

    // Phones from mediainfo_set
    const phones = (data.mediainfo_set || []).filter(m => m.type === 2 || m.type === 3)
    console.log(`   Phones: ${phones.map(p => `${p.value} (type=${p.type})`).join(', ')}`)

    const emails = (data.mediainfo_set || []).filter(m => m.type === 4)
    console.log(`   Emails: ${emails.map(e => e.value).join(', ') || 'none'}`)

    // Follow-up events
    const events = data.event_set || []
    console.log(`   Events: ${events.length}`)
    events.forEach(e => console.log(`     ${e.datetime || e.date}: ${e.title || e.description || 'follow-up'}`))

    // Notes
    const notes = data.contactnote_set || []
    console.log(`   Notes: ${notes.length}`)
    if (notes.length > 0) {
      console.log(`   Latest note: ${notes[0].contents?.substring(0, 100)}...`)
    }
  } else {
    console.log(`   ✗ Got HTML (not JSON) — endpoint still wrong?`)
  }

  // Test 2: Recording API
  console.log('\n2. Testing recording API for today...')
  const today = new Date().toISOString().split('T')[0]
  const recRes = await fetch(
    `${MOJO_BASE_URL}/v2/rest/reports/call-recording-report-data/?agents=%5B-1%5D&date_range=custom&from=${today}&to=${today}`,
    { headers: mojoHeaders(sid), signal: AbortSignal.timeout(15000) }
  )
  if (recRes.ok) {
    const recData = await recRes.json()
    const recordings = recData.recordings || []
    console.log(`   ✓ Found ${recordings.length} recording(s)`)
    recordings.forEach(r => {
      console.log(`   ${r.contact?.name} (${r.contact?.id}): ${r.duration} — ${r.result}`)
      console.log(`     Audio: ${r.audio?.substring(0, 80)}...`)
    })

    // Check for David Oglesby
    const oglesby = recordings.find(r => r.contact?.id === 3580)
    if (oglesby) {
      console.log(`\n   🎯 David Oglesby recording found: ${oglesby.duration}`)
    }
  } else {
    console.log(`   ✗ Recording API failed: ${recRes.status}`)
  }

  // Test 3: Activity type 6 (follow-up) in activity stream
  console.log('\n3. Checking for follow-up activities (type 6)...')
  const actRes = await fetch(`${MOJO_BASE_URL}/v2/rest/home/activity-stream/?page=1`, {
    headers: mojoHeaders(sid), signal: AbortSignal.timeout(15000)
  })
  if (actRes.ok) {
    const actData = await actRes.json()
    const followUps = (actData.activities || []).filter(a => a[1] === 6)
    console.log(`   Found ${followUps.length} follow-up(s)`)
    followUps.forEach(a => {
      const [id, type, agent, ts, details] = a
      console.log(`   ${details.contact_name}: ${details.datetime} (contact_id: ${details.contact_id})`)
    })
  }

  console.log('\n✓ All tests complete')
}

main().catch(err => { console.error(err); process.exit(1) })
