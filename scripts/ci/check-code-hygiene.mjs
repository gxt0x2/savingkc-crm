#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = process.cwd()
const registryPath = join(root, 'src/config/system-registry.json')
const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
const failures = []

function fail(message) {
  failures.push(message)
}

function git(args, fallback = '') {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return fallback
  }
}

function normalize(path) {
  return path.split(sep).join('/')
}

function countLines(content) {
  if (!content) return 0
  const lines = content.split('\n').length
  return content.endsWith('\n') ? lines - 1 : lines
}

function listFiles(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? listFiles(path) : [normalize(relative(root, path))]
  })
}

function appRouteForFile(file) {
  const withoutRoot = file.replace(/^src\/app\//, '').replace(/\/(page|route)\.tsx?$/, '')
  const segments = withoutRoot.split('/').filter((segment) => !/^\(.+\)$/.test(segment))
  return `/${segments.join('/')}`
}

function getBaseRef() {
  const requested = process.argv.includes('--base')
    ? process.argv[process.argv.indexOf('--base') + 1]
    : process.env.HYGIENE_BASE_REF
  if (requested && git(['rev-parse', '--verify', `${requested}^{commit}`])) return requested
  if (process.env.GITHUB_BASE_REF && git(['rev-parse', '--verify', `origin/${process.env.GITHUB_BASE_REF}^{commit}`])) {
    return `origin/${process.env.GITHUB_BASE_REF}`
  }
  return 'HEAD'
}

const baseRef = getBaseRef()
const nameStatus = git(['diff', '--name-status', baseRef, '--'])
const changed = new Map(
  nameStatus
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split('\t')
      return [paths.at(-1), status[0]]
    }),
)

for (const untracked of git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) {
  changed.set(untracked, 'A')
}

if (registry.schemaVersion !== 1 || !Array.isArray(registry.features)) {
  fail('System registry must use schemaVersion 1 and contain a features array.')
}

const ids = new Set()
for (const feature of registry.features) {
  if (!feature.id || ids.has(feature.id)) fail(`Feature id is missing or duplicated: ${feature.id || '<empty>'}`)
  ids.add(feature.id)
  for (const field of ['name', 'owner', 'status']) {
    if (!feature[field]) fail(`Feature ${feature.id} is missing ${field}.`)
  }
  for (const field of ['routes', 'apiRoutes', 'tables', 'environment']) {
    if (!Array.isArray(feature[field])) fail(`Feature ${feature.id}.${field} must be an array.`)
  }
  if (feature.status === 'deprecated' && !feature.retirement) {
    fail(`Deprecated feature ${feature.id} must include a retirement plan.`)
  }
}

const appFiles = listFiles(join(root, 'src/app')).filter((file) => /\/(page|route)\.tsx?$/.test(file))
const appRoutes = new Set(appFiles.map(appRouteForFile))
for (const feature of registry.features) {
  for (const route of [...feature.routes, ...feature.apiRoutes]) {
    if (!appRoutes.has(route)) fail(`Registered route does not exist: ${route} (${feature.id})`)
  }
}

const configuredCrons = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).crons ?? []
const registeredCrons = registry.features.flatMap((feature) =>
  (feature.crons ?? []).map((cron) => ({ ...cron, featureId: feature.id })),
)
for (const cron of configuredCrons) {
  const registered = registeredCrons.find((candidate) => candidate.path === cron.path && candidate.schedule === cron.schedule)
  if (!registered) fail(`Vercel cron is not registered with an owner: ${cron.path} (${cron.schedule})`)
  if (/^\*\/(5|10)\b/.test(cron.schedule) && !registered?.highFrequencyReason) {
    fail(`High-frequency cron needs a documented reason: ${cron.path}`)
  }
}
for (const cron of registeredCrons) {
  if (!configuredCrons.some((candidate) => candidate.path === cron.path && candidate.schedule === cron.schedule)) {
    fail(`Registered cron is missing from vercel.json: ${cron.path} (${cron.featureId})`)
  }
}

const registeredEnvironment = new Set(registry.features.flatMap((feature) => feature.environment))
const registeredTables = new Set(registry.features.flatMap((feature) => feature.tables))
const pollingApprovals = new Map(registry.policies.approvedPolling.map((approval) => [approval.path, approval]))
const oversizedApprovals = new Map(
  (registry.policies.approvedOversizedSources ?? []).map((approval) => [approval.path, approval]),
)
const suspiciousName = /(^|\/)(?:.*[-_.](?:old|bak|backup|copy|tmp)|.*\d{4}[-_]\d{2}[-_]\d{2}.*)\.(?:[cm]?[jt]sx?|css|json)$/i
const codeFile = /\.(?:[cm]?[jt]sx?|css)$/

for (const approval of oversizedApprovals.values()) {
  if (!approval.path || !approval.owner || !approval.reason || !approval.targetDate || !Number.isInteger(approval.maximumLines)) {
    fail(`Oversized-source approval is incomplete: ${approval.path || '<missing path>'}`)
    continue
  }
  const targetDate = new Date(`${approval.targetDate}T23:59:59Z`)
  if (Number.isNaN(targetDate.getTime()) || targetDate < new Date()) {
    fail(`Oversized-source approval is expired or invalid: ${approval.path} (${approval.targetDate})`)
  }
}

for (const [file, status] of changed) {
  if (!file || !existsSync(join(root, file))) continue
  const content = readFileSync(join(root, file), 'utf8')
  const beforeContent = status === 'A' ? '' : git(['show', `${baseRef}:${file}`])
  const lineCount = countLines(content)

  if (suspiciousName.test(file)) fail(`Temporary or versioned source filename is not allowed: ${file}`)
  const oversizedApproval = oversizedApprovals.get(file)
  if (codeFile.test(file) && lineCount > registry.policies.newFileMaxLines && oversizedApproval) {
    if (lineCount > oversizedApproval.maximumLines) {
      fail(`Approved oversized source exceeds its frozen ceiling: ${file} (${lineCount}/${oversizedApproval.maximumLines})`)
    }
  } else if (status === 'A' && codeFile.test(file) && lineCount > registry.policies.newFileMaxLines) {
    fail(`New source file exceeds ${registry.policies.newFileMaxLines} lines: ${file} (${lineCount})`)
  } else if (status !== 'A' && codeFile.test(file) && lineCount > registry.policies.newFileMaxLines) {
    const beforeLines = beforeContent ? countLines(beforeContent) : lineCount
    if (lineCount - beforeLines > registry.policies.oversizedExistingGrowthToleranceLines) {
      fail(`Oversized source grew by ${lineCount - beforeLines} lines: ${file}`)
    }
  }

  if (/\.(?:[cm]?[jt]sx?)$/.test(file)) {
    const priorEnvironment = new Set(
      [...beforeContent.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]),
    )
    for (const match of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      if (!priorEnvironment.has(match[1]) && !registeredEnvironment.has(match[1])) {
        fail(`Environment variable is not owned in the registry: ${match[1]} (${file})`)
      }
    }
    const usesPolling = /refetchInterval\s*:|setInterval\s*\(/.test(content)
    if (usesPolling) {
      const approval = pollingApprovals.get(file)
      if (!approval) fail(`Polling is not approved in the system registry: ${file}`)
      const numericIntervals = [...content.matchAll(/(?:refetchInterval\s*:|setInterval\s*\([^,]+,)\s*([\d_]+)/gs)]
        .map((match) => Number(match[1].replaceAll('_', '')))
        .filter(Number.isFinite)
      if (approval && numericIntervals.some((interval) => interval < approval.minimumIntervalMs)) {
        fail(`Polling interval is below the approved floor in ${file}.`)
      }
    }
    const priorTables = new Set(
      [...beforeContent.matchAll(/\.from\(['"]([a-zA-Z0-9_]+)['"]\)/g)].map((match) => match[1]),
    )
    for (const match of content.matchAll(/\.from\(['"]([a-zA-Z0-9_]+)['"]\)/g)) {
      if (!priorTables.has(match[1]) && !registeredTables.has(match[1])) {
        fail(`Database table is not owned in the registry: ${match[1]} (${file})`)
      }
    }
  }

  if (file.startsWith('supabase/migrations/') && /\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i.test(content)) {
    if (!/hygiene-approved-destructive:/i.test(content)) {
      fail(`Destructive migration lacks a hygiene-approved-destructive justification: ${file}`)
    }
  }
  if (file.startsWith('supabase/migrations/')) {
    for (const match of content.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)/gi)) {
      if (!registeredTables.has(match[1])) fail(`New migration table is not owned in the registry: ${match[1]} (${file})`)
    }
  }
}

if (changed.has('package.json')) {
  const beforePackage = JSON.parse(git(['show', `${baseRef}:package.json`], '{}') || '{}')
  const currentPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const beforeDependencies = { ...beforePackage.dependencies, ...beforePackage.devDependencies }
  const currentDependencies = { ...currentPackage.dependencies, ...currentPackage.devDependencies }
  const source = [...listFiles(join(root, 'src')), ...listFiles(join(root, 'scripts'))]
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
    .map((file) => readFileSync(join(root, file), 'utf8'))
    .join('\n')
  for (const dependency of Object.keys(currentDependencies)) {
    if (beforeDependencies[dependency] || dependency.startsWith('@types/')) continue
    const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!new RegExp(`(?:from\\s+|require\\(|import\\()\\s*['"]${escaped}(?:/|['"])`).test(source)) {
      fail(`New dependency has no runtime import in src or scripts: ${dependency}`)
    }
  }
}

const lintFiles = [...changed]
  .filter(([, status]) => status !== 'D')
  .map(([file]) => file)
  .filter((file) => file && existsSync(join(root, file)) && /\.[cm]?[jt]sx?$/.test(file))
const eslintBinary = join(root, 'node_modules/.bin/eslint')
if (lintFiles.length && existsSync(eslintBinary)) {
  try {
    execFileSync(eslintBinary, ['--max-warnings=0', ...lintFiles], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const details = [error.stdout, error.stderr].filter(Boolean).join('\n').trim()
    fail(`Changed-file ESLint failed.${details ? `\n${details}` : ''}`)
  }
}

if (failures.length) {
  console.error(`Code hygiene gate failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Code hygiene gate passed against ${baseRef} (${changed.size} changed files checked).`)
