#!/usr/bin/env node
/**
 * Reliable entrypoint for local Mojo cron jobs.
 *
 * The existing Mojo sync path depends on a browser session cookie stored on
 * this Mac. This runner refreshes that session when it is missing or marked
 * expired, then runs the requested sync job. If Mojo expires the session during
 * a run, it refreshes once and retries.
 *
 * Usage:
 *   node scripts/mojo-cron-runner.mjs sync
 *   node scripts/mojo-cron-runner.mjs eod
 *   node scripts/mojo-cron-runner.mjs eod --date 2026-05-21
 *   node scripts/mojo-cron-runner.mjs refresh
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadMojoEnv,
  mojoSessionFile,
  recordMojoSessionIssue,
} from './mojo-session-health.mjs'

loadMojoEnv()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SESSION_FILE = mojoSessionFile()
const EXTRACT_TIMEOUT_MS = Number(process.env.MOJO_EXTRACT_TIMEOUT_MS || 90_000)
const RUN_TIMEOUT_MS = Number(process.env.MOJO_RUN_TIMEOUT_MS || 180_000)
const MAX_SESSION_AGE_HOURS = Number(process.env.MOJO_SESSION_MAX_AGE_HOURS || 0)

const mode = process.argv[2] || 'sync'
const passthroughArgs = process.argv.slice(3)
const targetScript = {
  sync: 'mojo-sync.mjs',
  eod: 'mojo-eod-sweep.mjs',
  refresh: 'mojo-extract-session.mjs',
}[mode]

if (!targetScript) {
  console.error(`Unknown Mojo cron mode "${mode}". Use "sync", "eod", or "refresh".`)
  process.exit(2)
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function sessionRefreshReason() {
  if (!fs.existsSync(SESSION_FILE)) return 'missing'

  try {
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))
    if (session.expired) return 'expired'
    if (!session.sessionId) return 'missing_sessionId'

    if (MAX_SESSION_AGE_HOURS > 0) {
      const updatedAtMs = new Date(session.updatedAt || 0).getTime()
      const maxAgeMs = MAX_SESSION_AGE_HOURS * 60 * 60 * 1000
      if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > maxAgeMs) {
        return 'stale'
      }
    }

    return null
  } catch {
    return 'unreadable'
  }
}

function runNodeScript(scriptName, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join('scripts', scriptName), ...args], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: 'inherit',
    })

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
    }, timeoutMs)

    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({
        code: timedOut ? 124 : code ?? 1,
        signal,
        timedOut,
      })
    })
  })
}

async function refreshSession(reason) {
  log(`Refreshing Mojo session (${reason})...`)
  const result = await runNodeScript('mojo-extract-session.mjs', [], EXTRACT_TIMEOUT_MS)
  if (result.code !== 0) {
    log(`Mojo session refresh failed with exit code ${result.code}${result.timedOut ? ' (timeout)' : ''}`)
    await recordMojoSessionIssue({
      source: 'mojo-cron-runner',
      reason,
      message: 'Mojo session expired - manual refresh required',
    })
    return false
  }

  const remainingReason = sessionRefreshReason()
  if (remainingReason) {
    log(`Mojo session still not usable after refresh: ${remainingReason}`)
    return false
  }

  log('Mojo session refreshed.')
  return true
}

async function ensureSession() {
  const reason = sessionRefreshReason()
  if (!reason) return true
  return refreshSession(reason)
}

async function main() {
  if (mode === 'refresh') {
    process.exit((await refreshSession('scheduled_refresh')) ? 0 : 1)
  }

  if (!(await ensureSession())) {
    process.exit(1)
  }

  log(`Running Mojo ${mode} job...`)
  let result = await runNodeScript(targetScript, passthroughArgs, RUN_TIMEOUT_MS)

  if (result.code !== 0 && sessionRefreshReason()) {
    log(`Mojo ${mode} job failed and session is no longer usable. Refreshing once and retrying...`)
    if (await refreshSession('retry_after_expired_run')) {
      result = await runNodeScript(targetScript, passthroughArgs, RUN_TIMEOUT_MS)
    }
  }

  process.exit(result.code)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
