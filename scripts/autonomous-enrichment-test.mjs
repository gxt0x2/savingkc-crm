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

  section('AUTONOMOUS ENRICHMENT TEST - STARTED')
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
      timeout: 120000 // 2 min timeout
    })
    log('Build completed successfully')
  } catch {
    log(`BUILD FAILED: ${err.message}`)
    return
  }

  // Step 2: Kill old server
  section('STEP 2: Stopping old server')
  try {
    execSync('kill $(lsof -ti:3002) 2>/dev/null || true', { encoding: 'utf8' })
    log('Port 3002 cleared')
    await new Promise(resolve => setTimeout(resolve, 2000))
  } catch {
    log('No existing process on port 3002')
  }

  // Step 3: Start new server
  section('STEP 3: Starting Next.js server')
  log('Clearing log file...')
  fs.writeFileSync(LOG_FILE, '')

  log('Starting server on port 3002...')
  const serverProcess = spawn('npx', ['next', 'start', '-p', '3002'], {
    cwd: '/Users/ernestdodson/savingkc-crm',
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
  serverProcess.stdout.pipe(logStream)
  serverProcess.stderr.pipe(logStream)
  serverProcess.unref()

  // Wait for server to be ready
  log('Waiting for server to be ready...')
  let ready = false
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch('http://localhost:3002')
      if (response.status === 307 || response.status === 200) {
        ready = true
        log(`Server ready (status ${response.status})`)
        break
      }
    } catch {
      // Still starting up
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  if (!ready) {
    log('ERROR: Server did not start within 30 seconds')
    return
  }

  // Step 4: Create test bookings
  section('STEP 4: Creating test bookings')

  const now = new Date()
  const slotDate = now.toISOString().split('T')[0]
  const slotTime = '10:00 AM'
  const slotDatetime = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() // Tomorrow

  const testCases = [
    {
      name: 'Test 1: Prospect Match',
      phone: '+18167564943', // Casey's number (in prospects DB)
      address: '1234 Main St, Kansas City, MO 64106'
    },
    {
      name: 'Test 2: No Match (Jackson County)',
      phone: '+15551234567',
      address: '456 Oak Ave, Kansas City, MO 64110'
    },
    {
      name: 'Test 3: No Match (Clay County)',
      phone: '+15559876543',
      address: '789 Elm St, Liberty, MO 64068'
    }
  ]

  const leadIds = []

  for (const testCase of testCases) {
    log(`Creating: ${testCase.name}`)
    try {
      const response = await fetch('http://localhost:3002/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: testCase.name,
          phone: testCase.phone,
          property_address: testCase.address,
          slot_date: slotDate,
          slot_time: slotTime,
          slot_datetime: slotDatetime,
          source: 'autonomous_test'
        })
      })

      const result = await response.json()
      if (result.success) {
        leadIds.push(result.leadId)
        log(`✓ Created lead ${result.leadId}`)
      } else {
        log(`✗ Failed: ${result.error}`)
      }
    } catch (err) {
      log(`✗ Error: ${err.message}`)
    }

    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  // Step 5: Monitor enrichment logs
  section('STEP 5: Monitoring enrichment (120 seconds)')
  log('Watching logs for enrichment activity...')

  await new Promise(resolve => setTimeout(resolve, 120000)) // 2 minutes

  // Step 6: Analyze results
  section('STEP 6: Analyzing results')

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

  log(`Auto-enrich started: ${autoEnrichStarts} times`)
  log(`Prospect queued: ${prospectQueued} times`)
  log(`County queued: ${countyQueued} times`)
  log(`Prospect completed: ${prospectCompleted} times`)
  log(`County completed: ${countyCompleted} times`)
  log(`Timeouts: ${timeouts}`)
  log(`Rejections: ${rejections}`)

  // Check database for enrichment results
  for (const leadId of leadIds) {
    log(`\nChecking lead ${leadId}:`)

    const { data: manifest } = await supabase
      .from('manifests')
      .select('manifest')
      .eq('lead_id', leadId)
      .single()

    if (manifest?.manifest) {
      const auditTrail = manifest.manifest.auditTrail || []
      const prospectEnrich = auditTrail.find(e => e.action === 'prospect_enrichment_complete')
      const countyEnrich = auditTrail.find(e => e.action === 'county_enrichment_complete')

      log(`  Prospect enrichment: ${prospectEnrich ? '✓ YES' : '✗ NO'}`)
      log(`  County enrichment: ${countyEnrich ? '✓ YES' : '✗ NO'}`)

      if (prospectEnrich) {
        log(`    - Matched: ${prospectEnrich.metadata?.matched || 'unknown'}`)
      }
      if (countyEnrich) {
        log(`    - County: ${countyEnrich.metadata?.county || 'unknown'}`)
      }
    } else {
      log(`  ✗ No manifest found`)
    }
  }

  // Extract relevant log sections
  section('STEP 7: Relevant log excerpts')

  const logLines = serverLogs.split('\n')
  const enrichmentLines = logLines.filter(line =>
    line.includes('[auto-enrich]') ||
    line.includes('[county-enrichment]') ||
    line.includes('[prospect-to-lead]') ||
    line.includes('Timeout') ||
    line.includes('rejected')
  )

  log('Last 50 enrichment-related log lines:')
  enrichmentLines.slice(-50).forEach(line => log(line))

  // Final summary
  section('FINAL SUMMARY')
  const successRate = leadIds.length > 0
    ? ((prospectCompleted + countyCompleted) / (prospectQueued + countyQueued) * 100).toFixed(1)
    : 0

  log(`Test bookings created: ${leadIds.length}`)
  log(`Enrichments queued: ${prospectQueued + countyQueued}`)
  log(`Enrichments completed: ${prospectCompleted + countyCompleted}`)
  log(`Success rate: ${successRate}%`)
  log(`Timeouts encountered: ${timeouts}`)
  log(`Errors/rejections: ${rejections}`)

  if (successRate < 100) {
    log('\n⚠️  ENRICHMENT NOT AT 100% - REVIEW LOGS ABOVE')
  } else {
    log('\n✓ SUCCESS - 100% enrichment achieved!')
  }

  log(`\nFull server logs available at: ${LOG_FILE}`)
  log(`Test completed at ${new Date().toLocaleString()}`)

  console.log(`\n✓ Report saved to ${REPORT_FILE}`)
  console.log(`✓ Server logs at ${LOG_FILE}`)
}

main().catch(err => {
  log(`FATAL ERROR: ${err.message}`)
  console.error(err)
  process.exit(1)
})
