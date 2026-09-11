import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { serializeMojoSource } from '../src/lib/mojo-source-identity.mjs'
import { centralDateString, parseMojoTimestamp } from './mojo-call-evidence.mjs'

export const MOJO_INGESTION_VERSION = 'source-receipts-v1'

function dateAtNoon(date) {
  const parsed = new Date(`${date}T12:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid Mojo source date; checkpoint retained')
  }
  return parsed
}

export function mojoReplayStartDate(targetDate, lastSync) {
  const replay = new Date(dateAtNoon(targetDate).getTime() - 7 * 86400000).toISOString().slice(0, 10)
  if (!lastSync) return replay
  if (!Number.isFinite(Date.parse(lastSync))) throw new Error('Invalid Mojo checkpoint date; checkpoint retained')
  const checkpointDay = centralDateString(new Date(lastSync))
  return checkpointDay < replay ? checkpointDay : replay
}

// Mojo's own client requests date ranges. Its feed ignores `page` entirely.
export function mojoActivityDayUrl(baseUrl, date) {
  dateAtNoon(date)
  const [year, month, day] = date.split('-')
  const providerDate = `${month}/${day}/${year}`
  const url = new URL('/v2/rest/home/activity-stream/', baseUrl)
  url.search = new URLSearchParams({ start_date: providerDate, end_date: providerDate }).toString()
  return url.toString()
}

// Every requested Central day must succeed. Wrong-day rows reveal ignored
// filters; empty days are valid. A failed day never becomes a new checkpoint.
export async function collectMojoActivities(fetchDay, { since, to, maxDays = 100, maxRowsPerDay = 5000 }) {
  if (!Number.isFinite(Date.parse(since))) throw new Error('Invalid Mojo source boundary; checkpoint retained')
  const first = dateAtNoon(centralDateString(new Date(since)))
  const last = dateAtNoon(to)
  const dayCount = Math.round((last.getTime() - first.getTime()) / 86400000) + 1
  if (dayCount < 1 || dayCount > maxDays) throw new Error(`Mojo catch-up exceeds ${maxDays} days; checkpoint retained`)
  const rows = new Map()
  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = new Date(first.getTime() + offset * 86400000).toISOString().slice(0, 10)
    const activities = await fetchDay(date)
    if (!Array.isArray(activities)) throw new Error('Invalid Mojo activity day; checkpoint retained')
    if (activities.length >= maxRowsPerDay) throw new Error(`Mojo activity day ${date} reached the row safety limit; checkpoint retained`)
    for (const activity of activities) {
      if (!Array.isArray(activity) || !Number.isSafeInteger(activity[0]) || !activity[3]) {
        throw new Error('Invalid Mojo activity identity/timestamp; checkpoint retained')
      }
      if (centralDateString(new Date(parseMojoTimestamp(activity[3]))) !== date) {
        throw new Error(`Mojo ignored activity date filter for ${date}; checkpoint retained`)
      }
      if (rows.has(activity[0]) && serializeMojoSource(rows.get(activity[0])) !== serializeMojoSource(activity)) {
        throw new Error('Conflicting Mojo activity identity; checkpoint retained')
      }
      rows.set(activity[0], activity)
    }
  }
  return [...rows.values()]
}

export function assertMojoReceipts(calls, result) {
  const rejected = (Array.isArray(result?.receipts) ? result.receipts : []).filter(receipt => receipt.status === 'rejected')
    .slice(0, 5).map(receipt => `${receipt.recordId || 'unknown'}:${receipt.reason || 'rejected'}`).join(', ')
  if (result?.rejected !== 0 || result?.total !== calls.length || !Array.isArray(result?.receipts)) {
    throw new Error(`CRM did not confirm every Mojo record; checkpoint retained${rejected ? ` (${rejected})` : ''}`)
  }
  const receipts = new Map(result.receipts.map(receipt => [receipt.recordId, receipt.status]))
  if (calls.some(call => !['accepted', 'duplicate'].includes(receipts.get(call.record_id)))) {
    throw new Error('CRM rejected or deferred Mojo evidence; checkpoint retained')
  }
}

export function spoolMojoSource(directory, payload) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const serialized = serializeMojoSource(payload)
  const id = createHash('sha256').update(serialized).digest('hex')
  const filename = path.join(directory, `${id}.json`)
  if (!fs.existsSync(filename)) {
    const temporary = `${filename}.${process.pid}.tmp`
    const fd = fs.openSync(temporary, 'w', 0o600)
    try { fs.writeFileSync(fd, serialized); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temporary, filename)
  }
  return { id, filename, payload }
}

export function readMojoSpool(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort().map(name => {
    const filename = path.join(directory, name)
    const serialized = fs.readFileSync(filename, 'utf8')
    const id = createHash('sha256').update(serialized).digest('hex')
    if (`${id}.json` !== name) throw new Error('Mojo source spool checksum mismatch')
    return { id, filename, payload: JSON.parse(serialized) }
  })
}
