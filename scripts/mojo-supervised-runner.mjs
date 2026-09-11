#!/usr/bin/env node

import { spawn, execFileSync } from 'node:child_process'
import { verifyRuntime } from './mojo-runtime-package.mjs'
import { mojoSupervisorReceipt } from './mojo-supervisor-health.mjs'
import { runMojoRecovery } from './mojo-recovery-cycle.mjs'
import { mojoSchedule } from '../src/lib/marketing/mojo-schedule.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  adminHeaders,
  crmBaseUrl,
  defaultLogDir,
  loadMojoEnv,
  recordMojoFreshnessIssue,
} from './mojo-session-health.mjs'

loadMojoEnv()

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dirname, '..')
const stateRoot = path.dirname(defaultLogDir())
const lockFile = path.join(stateRoot, 'mojo-supervised-sync.lock')
const heartbeatFile = path.join(stateRoot, 'mojo-supervised-sync-heartbeat.json')
const timeoutMs = Math.max(1000, Math.min(240_000, Number(process.env.MOJO_SUPERVISED_TIMEOUT_MS) || 240_000))
let stopping = false
let stopRun = null
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { stopping = true; process.exitCode = 143; stopRun?.() })
}

function log(message) {
  console.log(`[${new Date().toISOString()}] [mojo-supervisor] ${message}`)
}

function inBusinessHours(now = new Date()) { return mojoSchedule(now).businessHours }

function acquireLock() {
  fs.mkdirSync(stateRoot, { recursive: true })
  try {
    const fd = fs.openSync(lockFile, 'wx', 0o600)
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    fs.closeSync(fd)
    return true
  } catch (error) {
    if (error?.code === 'EEXIST') {
      try {
        const existing = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
        const pid = Number(existing.pid)
        if (!Number.isInteger(pid) || pid <= 1) throw new SyntaxError('Invalid lock owner')
        process.kill(pid, 0)
        const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
        if (!command.includes('mojo-supervised-runner.mjs')) {
          fs.unlinkSync(lockFile)
          return acquireLock()
        }
        return false
      } catch (lockError) {
        if (lockError?.code !== 'ESRCH') {
          // An incomplete lock from a crashed writer cannot block forever.
          if (!(lockError instanceof SyntaxError) || Date.now() - fs.statSync(lockFile).mtimeMs < timeoutMs * 2) {
            throw new Error('Mojo supervisor lock cannot be validated', { cause: lockError })
          }
        }
        fs.unlinkSync(lockFile)
        return acquireLock()
      }
    }
    throw error
  }
}

function releaseLock() {
  try {
    if (JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === process.pid) fs.unlinkSync(lockFile)
  } catch {}
}

function runSync() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/mojo-cron-runner.mjs', 'sync'], {
      cwd: repoRoot, env: process.env, stdio: 'inherit', detached: true,
    })
    let timedOut = false
    let terminated
    const killGroup = signal => { try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error } }
    const terminate = () => {
      if (terminated) return
      killGroup('SIGTERM')
      terminated = new Promise(done => setTimeout(() => { killGroup('SIGKILL'); done() }, 5_000))
    }
    stopRun = terminate
    const timer = setTimeout(() => { timedOut = true; terminate() }, timeoutMs)
    child.on('error', () => { stopRun = null; clearTimeout(timer); resolve({ code: 1, timedOut: false }) })
    child.on('exit', async (code) => {
      clearTimeout(timer)
      if (terminated) await terminated
      stopRun = null
      resolve({ code: timedOut ? 124 : code ?? 1, timedOut })
    })
  })
}

async function checkHealth() {
  const response = await fetch(`${crmBaseUrl()}/api/admin/mojo-health?dryRun=1`, {
    headers: adminHeaders({ accept: 'application/json' }),
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.json().catch(() => null)
  return { response, health: body?.health ?? null }
}

async function reportRecovery(body) {
  const response = await fetch(`${crmBaseUrl()}/api/admin/mojo-recovery`, {
    method: 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result?.ok) throw new Error(`Recovery receipt rejected (${response.status})`)
  return result
}

async function main() {
  if (!inBusinessHours() && !process.argv.includes('--force')) {
    log('Outside supervised business hours; no work scheduled')
    return
  }
  if (!acquireLock()) {
    log('Another supervised run owns the lock; skipped overlap')
    return
  }
  try {
    const manifestPath = path.join(repoRoot, 'runtime-manifest.json')
    if (fs.existsSync(manifestPath)) {
      const manifest = verifyRuntime(repoRoot)
      log(`Runtime verified: revision=${manifest.revision}, content=${manifest.contentDigest}`)
    } else if (!fs.existsSync(path.join(repoRoot, '.git'))) {
      throw new Error('Installed Mojo runtime has no version manifest')
    }
    const cycle = await runMojoRecovery({
      stopped: () => stopping,
      sleep: ms => new Promise(resolve => {
        const timer = setTimeout(resolve, ms)
        stopRun = () => { clearTimeout(timer); resolve() }
      }),
      start: runId => reportRecovery({ event: 'start', runId }),
      runAttempt: async attempt => {
        log(`Automatic recovery attempt ${attempt}/3`)
        const result = await runSync()
        if (result.code === 0 && !stopping) {
          const { health } = await checkHealth().catch(() => ({ health: null }))
          if (!health || health.performance?.status !== 'current'
            || health.performance?.latestMetricDate !== mojoSchedule().date
            || health.performance?.syncHealth === 'down') {
            // The hosted KPI path owns storage and already retries source reads.
            // The preceding sync renews/pushes the provider session before this request.
            const response = await fetch(`${crmBaseUrl()}/api/cron/sync-mojo-performance?force=1`, {
              method: 'POST', headers: adminHeaders(), signal: AbortSignal.timeout(70_000),
            }).catch(() => null)
            if (!response?.ok) log(`Provider totals recovery returned ${response?.status || 'no response'}; verifying before the next attempt`)
          }
        }
        return result
      },
      report: (runId, attempts) => reportRecovery({ event: 'attempt', runId, attempts }),
      retain: cycle => {
        const health = cycle.server?.health ?? null
        const receipt = { ...mojoSupervisorReceipt(cycle.result || { code: 1, timedOut: false }, health), recovery: cycle }
        if (cycle.status !== 'recovered') { receipt.status = cycle.status; receipt.operationalAttention = cycle.status === 'exhausted' }
        fs.writeFileSync(`${heartbeatFile}.tmp`, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
        fs.renameSync(`${heartbeatFile}.tmp`, heartbeatFile)
        fs.appendFileSync(path.join(stateRoot, 'mojo-recovery-history.jsonl'), `${JSON.stringify(cycle)}\n`, { mode: 0o600 })
      },
    })
    log(`Recovery cycle ${cycle.runId}: ${cycle.status}, attempts=${cycle.attempts.length}`)
    if (cycle.status !== 'recovered') process.exitCode = 1

  } finally {
    releaseLock()
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[mojo-supervisor] ${message}`)
  fs.writeFileSync(heartbeatFile, `${JSON.stringify({ ...mojoSupervisorReceipt({ code: 1, timedOut: false }, null), error: message }, null, 2)}\n`, { mode: 0o600 })
  await recordMojoFreshnessIssue({ source: 'mojo-supervised-runner', reason: 'supervisor_exception', message: `Mojo supervisor failed: ${message}` })
  releaseLock()
  process.exit(1)
})
