#!/usr/bin/env node

import { execSync, spawn } from 'child_process'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

// Load environment variables from .env.local
const envFile = fs.readFileSync('/Users/ernestdodson/savingkc-crm/.env.local', 'utf8')
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=:#]+)=(.*)$/)
  if (match) {
    const key = match[1].trim()
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    process.env[key] = value
  }
})

const REPORT_FILE = '/tmp/enrichment-test-report.txt'
const LOG_FILE = '/tmp/crm-next-live.log'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function log(msg) {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${msg}\n`
  console.log(line.trim())
  fs.appendFileSync(REPORT_FILE, line)
}

function section(title) {
  const line = `\n${'='.repeat(80)}\n${title}\n${'='.repeat(80)}\n`
  console.log(line)
  fs.appendFileSync(REPORT_FILE, line)
}

async function main() {
  // Clear old report
  fs.writeFileSync(REPORT_FILE, '')

  section('AUTONOMOUS ENRICHMENT TEST - V2')
  log(`Started at ${new Date().toLocaleString()}`)

  // Step 1: Rebuild Next.js
  section('STEP 1: Rebuilding Next.js')
  try {
    log('Removing .next directory...')
    execSync('rm -rf .next', { cwd: '/Users/ernestdodson/savingkc-crm' })

    log('Running next build...')
    execSync('npx next build', {
      cwd: '/Users/ernestdodson/savingkc-crm',
      encoding: 'utf8',
      timeout: 120000
    })
    log('✓ Build completed')
  } catch (err) {
    log(`✗ BUILD FAILED: ${err.message}`)
    return
  }

  // Step 2: Kill ALL processes on port 3002
  section('STEP 2: Stopping all servers on port 3002')
  try {
    const pids = execSync('lsof -ti:3002 || true', { encoding: 'utf8' }).trim()
    if (pids) {
      log(`Found processes: ${pids.split('\n').join(', ')}`)
      execSync('kill -9 $(lsof -ti:3002) 2>/dev/null || true', { encoding: 'utf8' })
      log('✓ Killed all processes')
      await new Promise(resolve => setTimeout(resolve, 3000))
    } else {
      log('No processes found on port 3002')
    }
  } catch (err) {
    log(`Error stopping servers: ${err.message}`)
  }

  // Step 3: Start new server
  section('STEP 3: Starting Next.js server')
  log('Clearing log file...')
  fs.writeFileSync(LOG_FILE, '')

  log('Starting server on port 3002...')
  const serverProcess = spawn('npx', ['next', 'start', '-p', '3002'], {
    cwd: '/Users/ernestdodson/savingkc-crm',
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }
  })

  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
  serverProcess.stdout.pipe(logStream)
  serverProcess.stderr.pipe(logStream)
  serverProcess.unref()

  // Wait for server to be ready
  log('Waiting for server to start...')
  let ready = false
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch('http://localhost:3002')
      if (response.status === 307 || response.status === 200) {
        ready = true
        log(`✓ Server ready (HTTP ${response.status})`)
        break
      }
    } catch (err) {
      // Still starting
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  if (!ready) {
    log('✗ Server failed to start within 40 seconds')
    const serverLog = fs.readFileSync(LOG_FILE, 'utf8')
    log('Server log output:')
    log(serverLog)
    return
  }

  // Give server extra time to fully initialize
  await new Promise(resolve => setTimeout(resolve, 5000))

  // Step 4: Create test bookings with DIFFERENT time slots
  section('STEP 4: Creating test bookings')

  const baseDate = new Date()
  const testCases = [
    {
      name: 'AutoTest Prospect Match',
      phone: '+18167564943', // Casey's number
      address: '1234 Main St, Kansas City, MO 64106',
      slotOffset: 1 // Tomorrow 10 AM
    },
    {
      name: 'AutoTest Jackson County',
      phone: '+15551234001',
      address: '456 Oak Ave, Kansas City, MO 64110',
      slotOffset: 2 // Day after tomorrow 10 AM
    },
    {
      name: 'AutoTest Clay County',
      phone: '+15551234002',
      address: '789 Elm St, Liberty, MO 64068',
      slotOffset: 3 // 3 days from now 10 AM
    }
  ]

  const leadIds = []
  const bookingIds = []

  for (const testCase of testCases) {
    log(`Creating: ${testCase.name}`)

    const slotDate = new Date(baseDate)
    slotDate.setDate(slotDate.getDate() + testCase.slotOffset)
    const slotDateStr = slotDate.toISOString().split('T')[0]
    const slotDatetime = new Date(slotDate.setHours(10, 0, 0, 0)).toISOString()

    try {
      const response = await fetch('http://localhost:3002/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: testCase.name,
          phone: testCase.phone,
          property_address: testCase.address,
          slot_date: slotDateStr,
          slot_time: '10:00 AM',
          slot_datetime: slotDatetime,
          source: 'autonomous_test_v2'
        })
      })

      const result = await response.json()
      if (result.success && result.booking_id) {
        bookingIds.push(result.booking_id)
        log(`✓ Created booking ${result.booking_id}`)

        // Get lead_id from booking
        const { data: booking } = await supabase
          .from('bookings')
          .select('lead_id')
          .eq('id', result.booking_id)
          .single()

        if (booking?.lead_id) {
          leadIds.push(booking.lead_id)
          log(`  → Lead ID: ${booking.lead_id}`)
        } else {
          log(`  ✗ Could not find lead_id for booking ${result.booking_id}`)
        }
      } else {
        log(`✗ Failed: ${result.error || 'Unknown error'}`)
      }
    } catch (err) {
      log(`✗ Error: ${err.message}`)
    }

    await new Promise(resolve => setTimeout(resolve, 3000))
  }

  log(`\n✓ Created ${leadIds.length} leads: ${leadIds.join(', ')}`)

  // Step 5: Monitor enrichment logs
  section('STEP 5: Monitoring enrichment (120 seconds)')
  log('Waiting for auto-enrichment to run...')

  await new Promise(resolve => setTimeout(resolve, 120000))

  // Step 6: Analyze results
  section('STEP 6: Analyzing Results')

  // Read server logs
  const serverLogs = fs.readFileSync(LOG_FILE, 'utf8')

  // Count enrichment events
  const autoEnrichStarts = (serverLogs.match(/\[auto-enrich\] Starting for lead/g) || []).length
  const prospectQueued = (serverLogs.match(/Queuing prospect enrichment/g) || []).length
  const countyQueued = (serverLogs.match(/Queuing county enrichment/g) || []).length
  const prospectCompleted = (serverLogs.match(/enrichFromProspect COMPLETED/g) || []).length
  const countyCompleted = (serverLogs.match(/enrichFromCounty COMPLETED/g) || []).length
  const timeouts = (serverLogs.match(/Timeout \d+ms exceeded/g) || []).length
  const rejections = (serverLogs.match(/Enrichment \d+ rejected/g) || []).length
  const dedupSkips = (serverLogs.match(/already enriched, skipping/g) || []).length

  log(`Auto-enrich triggered: ${autoEnrichStarts} times`)
  log(`Prospect queued: ${prospectQueued}`)
  log(`County queued: ${countyQueued}`)
  log(`Prospect completed: ${prospectCompleted}`)
  log(`County completed: ${countyCompleted}`)
  log(`Dedup skips: ${dedupSkips}`)
  log(`Timeouts: ${timeouts}`)
  log(`Promise rejections: ${rejections}`)

  // Check database for enrichment results
  let prospectEnriched = 0
  let countyEnriched = 0

  for (const leadId of leadIds) {
    log(`\nLead ${leadId}:`)

    const { data: manifest } = await supabase
      .from('manifests')
      .select('manifest')
      .eq('lead_id', leadId)
      .single()

    if (manifest?.manifest) {
      const auditTrail = manifest.manifest.auditTrail || []
      const prospectEvent = auditTrail.find(e => e.action === 'prospect_enrichment_complete')
      const countyEvent = auditTrail.find(e => e.action === 'county_enrichment_complete')

      if (prospectEvent) {
        prospectEnriched++
        log(`  ✓ Prospect enrichment (matched: ${prospectEvent.metadata?.matched || 'unknown'})`)
      } else {
        log(`  ✗ No prospect enrichment`)
      }

      if (countyEvent) {
        countyEnriched++
        log(`  ✓ County enrichment (${countyEvent.metadata?.county || 'unknown'})`)
      } else {
        log(`  ✗ No county enrichment`)
      }
    } else {
      log(`  ✗ No manifest found`)
    }
  }

  // Extract relevant log sections
  section('STEP 7: Log Excerpts')

  const logLines = serverLogs.split('\n')
  const enrichmentLines = logLines.filter(line =>
    line.includes('[auto-enrich]') ||
    line.includes('[county-enrichment]') ||
    line.includes('[prospect-to-lead]') ||
    line.includes('Timeout') ||
    line.includes('rejected') ||
    line.includes('COMPLETED')
  )

  if (enrichmentLines.length > 0) {
    log(`Last ${Math.min(50, enrichmentLines.length)} enrichment-related log lines:`)
    enrichmentLines.slice(-50).forEach(line => log(line.substring(0, 200)))
  } else {
    log('⚠️  NO ENRICHMENT LOGS FOUND')
  }

  // Final summary
  section('FINAL SUMMARY')

  const totalQueued = prospectQueued + countyQueued
  const totalCompleted = prospectCompleted + countyCompleted
  const successRate = totalQueued > 0 ? ((totalCompleted / totalQueued) * 100).toFixed(1) : '0.0'

  log(`Test leads created: ${leadIds.length}`)
  log(`Auto-enrich triggered: ${autoEnrichStarts}`)
  log(`Enrichments queued: ${totalQueued} (${prospectQueued} prospect + ${countyQueued} county)`)
  log(`Enrichments completed: ${totalCompleted} (${prospectCompleted} prospect + ${countyCompleted} county)`)
  log(`Database enrichments: ${prospectEnriched} prospect + ${countyEnriched} county`)
  log(`Success rate: ${successRate}%`)
  log(`Timeouts: ${timeouts}`)
  log(`Rejections: ${rejections}`)

  if (parseFloat(successRate) >= 100) {
    log('\n✓ SUCCESS - 100% enrichment rate achieved!')
  } else {
    log(`\n⚠️  INCOMPLETE - Only ${successRate}% success rate`)
    log('Review logs above for errors')
  }

  log(`\nFull server logs: ${LOG_FILE}`)
  log(`Test completed at ${new Date().toLocaleString()}`)

  console.log(`\n✓ Report saved to ${REPORT_FILE}`)
}

main().catch(err => {
  log(`FATAL ERROR: ${err.stack}`)
  console.error(err)
  process.exit(1)
})
