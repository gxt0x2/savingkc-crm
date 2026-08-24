#!/usr/bin/env node

import { spawn } from 'node:child_process'
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
const timeoutMs = Number(process.env.MOJO_SUPERVISED_TIMEOUT_MS || 5 * 60 * 1000)

function log(message) {
  console.log(`[${new Date().toISOString()}] [mojo-supervisor] ${message}`)
}

function inBusinessHours(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(now)
  const weekday = parts.find((part) => part.type === 'weekday')?.value || ''
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0)
  return !['Sat', 'Sun'].includes(weekday) && hour >= 8 && hour < 18
}

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
        if (Number.isInteger(pid) && pid > 1) process.kill(pid, 0)
        return false
      } catch (lockError) {
        if (lockError?.code !== 'ESRCH') return false
        fs.unlinkSync(lockFile)
        return acquireLock()
      }
    }
    throw error
  }
}

function releaseLock() {
  try { fs.unlinkSync(lockFile) } catch {}
}

function runSync() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/mojo-cron-runner.mjs', 'sync'], {
      cwd: repoRoot, env: process.env, stdio: 'inherit',
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
    }, timeoutMs)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code: timedOut ? 124 : code ?? 1, timedOut })
    })
  })
}

async function checkHealth() {
  const response = await fetch(`${crmBaseUrl()}/api/admin/mojo-health`, {
    headers: adminHeaders({ accept: 'application/json' }),
    signal: AbortSignal.timeout(20_000),
  })
  const body = await response.json().catch(() => null)
  return { response, health: body?.health ?? null }
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
    const result = await runSync()
    if (result.code !== 0) {
      await recordMojoFreshnessIssue({
        source: 'mojo-supervised-runner',
        reason: result.timedOut ? 'sync_timeout' : 'sync_failed',
        message: `Mojo supervised sync failed${result.timedOut ? ' after its five-minute timeout' : ` with exit code ${result.code}`}.`,
      })
      process.exitCode = result.code
      return
    }

    const { response, health } = await checkHealth()
    if (!health || response.status >= 500 || health.status === 'attention') {
      const message = health?.message || `Mojo freshness check failed with HTTP ${response.status}`
      await recordMojoFreshnessIssue({ source: 'mojo-supervised-runner', reason: 'freshness_attention', message })
      process.exitCode = 1
      return
    }

    fs.writeFileSync(heartbeatFile, `${JSON.stringify({
      status: 'healthy', completedAt: new Date().toISOString(), lastSyncAt: health.lastSyncAt || null,
      queue: health.queue || null,
    }, null, 2)}\n`, { mode: 0o600 })
    log(`Completed; freshness=${health.lastSyncAgeMinutes ?? 'unknown'}m, queue=${(health.queue?.pending ?? 0) + (health.queue?.processing ?? 0)}`)
  } finally {
    releaseLock()
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[mojo-supervisor] ${message}`)
  await recordMojoFreshnessIssue({ source: 'mojo-supervised-runner', reason: 'supervisor_exception', message: `Mojo supervisor failed: ${message}` })
  releaseLock()
  process.exit(1)
})
