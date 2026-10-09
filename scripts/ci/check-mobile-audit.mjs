#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mobileRoot = process.cwd()
const exceptionsPath = join(mobileRoot, 'security-advisory-exceptions.json')
const configuration = JSON.parse(readFileSync(exceptionsPath, 'utf8'))
const failures = []

function fail(message) {
  failures.push(message)
}

function loadAuditReport() {
  try {
    return JSON.parse(execFileSync('npm', ['audit', '--json'], {
      cwd: mobileRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }))
  } catch (error) {
    if (!error.stdout) throw error
    return JSON.parse(error.stdout)
  }
}

function advisoryId(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.url !== 'string') return null
  const match = entry.url.match(/\/(GHSA-[a-z0-9-]+)$/i)
  return match?.[1] ?? null
}

function collectAdvisories(name, vulnerabilities, seen = new Set()) {
  if (seen.has(name)) return new Set()
  seen.add(name)
  const vulnerability = vulnerabilities[name]
  if (!vulnerability) return new Set([`unresolved:${name}`])

  const found = new Set()
  for (const via of vulnerability.via ?? []) {
    if (typeof via === 'string') {
      for (const id of collectAdvisories(via, vulnerabilities, new Set(seen))) found.add(id)
      continue
    }
    const id = advisoryId(via)
    found.add(id ?? `unresolved:${via?.name ?? name}`)
  }
  return found
}

if (configuration.schemaVersion !== 1 || !Array.isArray(configuration.exceptions)) {
  fail('Mobile security exceptions must use schemaVersion 1 and contain an exceptions array.')
}

const approved = new Map()
for (const exception of configuration.exceptions ?? []) {
  if (!exception.advisoryId || !exception.package || !exception.owner || !exception.reason || !exception.expiresOn) {
    fail(`Mobile security exception is incomplete: ${exception.advisoryId || '<missing advisory>'}`)
    continue
  }
  const expiry = new Date(`${exception.expiresOn}T23:59:59Z`)
  if (Number.isNaN(expiry.getTime()) || expiry < new Date()) {
    fail(`Mobile security exception is expired or invalid: ${exception.advisoryId} (${exception.expiresOn})`)
  }
  approved.set(exception.advisoryId, exception)
}

const report = loadAuditReport()
const vulnerabilities = report.vulnerabilities ?? {}
const observed = new Set()

for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  if (vulnerability.severity === 'critical') {
    fail(`Critical mobile vulnerability is never exempted: ${name}`)
    continue
  }
  if (!['high', 'critical'].includes(vulnerability.severity)) continue
  const advisories = collectAdvisories(name, vulnerabilities)
  if (advisories.size === 0) fail(`High mobile vulnerability has no traceable advisory: ${name}`)
  for (const id of advisories) {
    observed.add(id)
    if (!approved.has(id)) fail(`Mobile vulnerability is not approved: ${name} (${id})`)
  }
}

for (const id of approved.keys()) {
  if (!observed.has(id)) fail(`Remove unused mobile security exception: ${id}`)
}

if (failures.length > 0) {
  console.error(`Mobile dependency security gate failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

if (observed.size > 0) {
  console.warn(`Mobile dependency security gate passed with ${observed.size} temporary, expiring upstream exception(s):`)
  for (const id of observed) {
    const exception = approved.get(id)
    console.warn(`- ${id} (${exception.package}) expires ${exception.expiresOn}; owner: ${exception.owner}`)
  }
} else {
  console.log('Mobile dependency security gate passed with no high or critical findings.')
}
