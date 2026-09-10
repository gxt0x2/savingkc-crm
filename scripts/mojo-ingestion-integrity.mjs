import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { serializeMojoSource } from '../src/lib/mojo-source-identity.mjs'
import { parseMojoTimestamp } from './mojo-call-evidence.mjs'

export const MOJO_INGESTION_VERSION = 'source-receipts-v1'

// No page failure or page cap may be converted into a successful checkpoint.
// Read through BOTH the old checkpoint and the replay window (late evidence).
export async function collectMojoActivities(fetchPage, { lastActivityId = 0, since, maxPages = 100 }) {
  const rows = new Map()
  let previousOldest = Infinity
  for (let page = 1; page <= maxPages; page += 1) {
    const activities = await fetchPage(page)
    if (!Array.isArray(activities)) throw new Error('Invalid Mojo activity page')
    if (activities.length === 0) return [...rows.values()]
    for (const activity of activities) {
      if (!Array.isArray(activity) || !Number.isSafeInteger(activity[0]) || !activity[3]) {
        throw new Error('Invalid Mojo activity identity/timestamp; checkpoint retained')
      }
      parseMojoTimestamp(activity[3])
      rows.set(activity[0], activity)
    }
    const oldestId = Math.min(...activities.map(row => row[0]))
    const oldestTime = Math.min(...activities.map(row => Date.parse(parseMojoTimestamp(row[3]))))
    if (oldestId >= previousOldest) throw new Error('Mojo pagination made no progress; checkpoint retained')
    previousOldest = oldestId
    if (oldestTime < Date.parse(since) && (!lastActivityId || oldestId <= lastActivityId)) {
      return [...rows.values()]
    }
  }
  throw new Error(`Mojo catch-up exceeded ${maxPages} pages; checkpoint retained`)
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
