import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { env, git, githubPages, repoFromOrigin } from './ci/github-api.mjs'

export const reservedPath = 'supabase/migrations/RESERVED.json'

export function versionOf(file) {
  return /^(\d{14})_/.exec(String(file).split('/').pop() ?? '')?.[1] ?? null
}
export function isMigrationPath(file) {
  const name = String(file).replaceAll('\\', '/')
  return name.startsWith('supabase/migrations/') && name.endsWith('.sql')
}

function group(files) {
  const grouped = new Map()
  for (const file of files) {
    const version = isMigrationPath(file) ? versionOf(file) : null
    if (!version) continue
    grouped.set(version, [...(grouped.get(version) ?? []), file])
  }
  return grouped
}

export function parseVersion(version) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(version)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute && date.getUTCSeconds() === second
  return valid ? date : null
}

export function formatVersion(date) {
  const pad = (value, size = 2) => String(value).padStart(size, '0')
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
}

export function nextFreeVersion(versions) {
  const taken = new Set(versions.filter((version) => /^\d{14}$/.test(version)))
  let max = null
  for (const version of taken) if (max === null || version > max) max = version
  let cursor = max ? parseVersion(max) : new Date()
  if (!cursor) throw new Error(`Migration version ${max} is not a real timestamp.`)
  cursor = new Date(cursor.getTime() + (max ? 1000 : 0))
  cursor.setUTCMilliseconds(0)
  for (let step = 0; step < 100000; step += 1) {
    const version = formatVersion(cursor)
    if (!taken.has(version)) return version
    cursor = new Date(cursor.getTime() + 1000)
  }
  throw new Error('No free migration version found.')
}

export function sortReservations(entries) {
  return [...entries].sort((left, right) => left.version === right.version
    ? (left.pr ?? Number.POSITIVE_INFINITY) - (right.pr ?? Number.POSITIVE_INFINITY)
    : left.version < right.version ? -1 : 1)
}

export function normalizeReservation(entry) {
  return {
    version: String(entry.version),
    pr: entry.pr == null ? null : Number(entry.pr),
    owner: String(entry.owner),
    note: String(entry.note),
  }
}

export function readReserved(root) {
  const parsed = JSON.parse(readFileSync(join(root, reservedPath), 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('RESERVED.json must be an array.')
  return parsed.map((entry) => {
    const normalized = normalizeReservation(entry ?? {})
    if (!/^\d{14}$/.test(normalized.version) || !parseVersion(normalized.version)) {
      throw new Error('RESERVED.json entry is missing a 14-digit timestamp version.')
    }
    if (normalized.pr !== null && !Number.isInteger(normalized.pr)) {
      throw new Error(`RESERVED.json pr must be an integer or null (${normalized.version}).`)
    }
    if (!normalized.owner || !normalized.note) throw new Error(`RESERVED.json entry ${normalized.version} needs owner and note.`)
    return normalized
  })
}

function reservationText(entries) {
  return `[\n${sortReservations(entries).map((entry) => `  ${JSON.stringify(normalizeReservation(entry))}`).join(',\n')}\n]\n`
}

export function runCheck({ treeFiles, baseFiles, addedFiles, reserved, prNumber, otherOpenMigrations = [] }) {
  const failures = []
  const reports = []
  const tree = group(treeFiles)
  const base = group(baseFiles)
  for (const version of [...tree.keys()].sort()) {
    const files = [...tree.get(version)].sort()
    if (files.length < 2) continue
    const baseCount = base.get(version)?.length ?? 0
    if (baseCount >= 2 && files.length <= baseCount) {
      reports.push(`Pre-existing duplicate 14-digit version ${version} (${files.join(', ')}). Report only.`)
      continue
    }
    failures.push(`Duplicate 14-digit migration version ${version}: ${files.join(', ')}`)
  }
  const added = []
  for (const file of addedFiles) {
    const version = isMigrationPath(file) ? versionOf(file) : null
    if (!version || added.some((item) => item.version === version && item.file === file)) continue
    added.push({ version, file })
    const others = (base.get(version) ?? []).filter((existing) => existing !== file)
    if (others.length > 0 && (tree.get(version)?.length ?? 0) < 2 && (base.get(version)?.length ?? 0) < 2) {
      failures.push(`Duplicate 14-digit migration version ${version}: ${file} collides with ${others.join(', ')}`)
    }
  }
  if (prNumber != null && prNumber !== '') {
    const pr = Number(prNumber)
    for (const version of [...new Set(added.map((item) => item.version))]) {
      const sample = added.find((item) => item.version === version)
      if (!reserved.some((entry) => entry.version === version && Number(entry.pr) === pr)) {
        failures.push(`Migration ${version} added in this PR (${sample.file}) is not reserved in supabase/migrations/RESERVED.json for PR #${pr}.`)
      }
      for (const collision of otherOpenMigrations) {
        if (collision.version === version && Number(collision.pr) !== pr) {
          failures.push(`Migration version ${version} added in this PR collides with ${collision.file} on open PR #${collision.pr}.`)
        }
      }
    }
  }
  const ok = failures.length === 0
  let summary = 'Migration version check passed. No duplicate 14-digit migration versions.'
  if (!ok) summary = `Migration version check failed (${failures.length}).`
  else if (reports.length > 0) summary = `Migration version check passed. ${reports.length} pre-existing duplicate version${reports.length === 1 ? '' : 's'} reported only.`
  else if (added.length > 0) summary = `Migration version check passed. ${added.length} added migration version${added.length === 1 ? '' : 's'} reserved for this PR with no open-PR collision.`
  return { ok, failures, reports, summary }
}

function option(argv, name) {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

function listTree(root) {
  return readdirSync(join(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).map((name) => `supabase/migrations/${name}`)
}

function refExists(root, ref) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], root)
    return true
  } catch {
    return false
  }
}

function listAtRef(root, ref) {
  const output = git(['ls-tree', '-r', '--name-only', ref, '--', 'supabase/migrations'], root)
  return output ? output.split('\n').filter(Boolean) : []
}

function addedSince(root, base) {
  const output = git(['diff', '--name-status', '--find-renames', `${base}...HEAD`, '--', 'supabase/migrations'], root)
  const added = []
  for (const line of output.split('\n').filter(Boolean)) {
    const [status, , renamed] = line.split('\t')
    if (status.startsWith('A') || status.startsWith('R') || status.startsWith('C')) added.push(renamed ?? line.split('\t').at(-1))
  }
  let untracked = ''
  try {
    untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'supabase/migrations'], root)
  } catch {
    untracked = ''
  }
  for (const file of untracked.split('\n').filter((name) => name.endsWith('.sql'))) added.push(file)
  return added
}

export async function otherOpenMigrations(repo, prNumber) {
  const pulls = await githubPages(`/repos/${repo}/pulls?state=open`)
  const found = []
  for (const pull of pulls) {
    if (prNumber != null && Number(pull.number) === Number(prNumber)) continue
    const files = await githubPages(`/repos/${repo}/pulls/${pull.number}/files`)
    for (const file of files) {
      const version = ['added', 'renamed', 'copied'].includes(file.status) ? versionOf(file.filename) : null
      if (version && isMigrationPath(file.filename)) found.push({ pr: pull.number, version, file: file.filename })
    }
  }
  return found
}

function splitList(value) {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}

async function reserve(argv, io) {
  const root = option(argv, '--root') ?? process.cwd()
  const owner = option(argv, '--owner')
  const note = option(argv, '--note')
  const prRaw = option(argv, '--pr')
  if (!owner || !note) {
    io.error('Usage: scripts/reserve-migration-version --pr <number|null> --owner <login> --note <text>')
    return 1
  }
  const pr = !prRaw || prRaw === 'null' ? null : Number(prRaw)
  if (pr !== null && !Number.isInteger(pr)) {
    io.error('PR must be an integer or null.')
    return 1
  }
  const versions = new Set()
  const mainRef = refExists(root, 'origin/main') ? 'origin/main' : 'main'
  for (const file of listAtRef(root, mainRef)) {
    const version = versionOf(file)
    if (version) versions.add(version)
  }
  const reserved = readReserved(root)
  for (const entry of reserved) versions.add(entry.version)
  const inline = option(argv, '--open')
  const open = inline ? JSON.parse(inline) : await otherOpenMigrations(repoFromOrigin(root), null)
  for (const entry of open) versions.add(entry.version)
  const next = nextFreeVersion([...versions])
  writeFileSync(join(root, reservedPath), reservationText([...reserved, { version: next, pr, owner, note }]))
  io.log(`Reserved ${next} in ${reservedPath}.`)
  return 0
}

export async function execute(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  if (argv.includes('--reserve')) return reserve(argv, io)
  const root = option(argv, '--root') ?? process.cwd()
  const prRaw = option(argv, '--pr') ?? env('PR_NUMBER')
  const prNumber = prRaw ? Number(prRaw) : null
  const reserved = readReserved(root)
  let treeFiles
  let baseFiles
  let addedFiles
  if (argv.includes('--tree')) {
    treeFiles = splitList(option(argv, '--tree'))
    baseFiles = splitList(option(argv, '--base'))
    addedFiles = splitList(option(argv, '--added'))
  } else {
    treeFiles = listTree(root)
    const base = option(argv, '--base-ref') || env('BASE_SHA') || 'HEAD'
    baseFiles = listAtRef(root, base)
    addedFiles = prNumber ? addedSince(root, base) : []
  }
  let open = []
  if (prNumber && addedFiles.some((file) => versionOf(file))) {
    const inline = option(argv, '--open') || env('OPEN_MIGRATIONS_JSON')
    open = inline ? JSON.parse(inline) : await otherOpenMigrations(repoFromOrigin(root), prNumber)
  }
  const result = runCheck({ treeFiles, baseFiles, addedFiles, reserved, prNumber, otherOpenMigrations: open })
  for (const line of result.reports) io.log(line)
  for (const line of result.failures) io.error(line)
  io.log(result.summary)
  return result.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  execute().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    },
  )
}
