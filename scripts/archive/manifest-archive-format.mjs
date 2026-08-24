import { createHash } from 'node:crypto'
import { resolve, sep } from 'node:path'

export const MANIFEST_ARCHIVE_FORMAT = 'savingkc-manifest-archive-v1'

function normalizeJson(value) {
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, normalizeJson(child)]),
    )
  }
  return value
}

export function stableJson(value) {
  return JSON.stringify(normalizeJson(value))
}

export function archiveLine(value) {
  return `${stableJson(value)}\n`
}

export function createArchiveDigest() {
  const hash = createHash('sha256')
  let rowCount = 0

  return {
    update(value) {
      hash.update(archiveLine(value), 'utf8')
      rowCount += 1
    },
    finish() {
      return { rowCount, sha256: hash.digest('hex') }
    },
  }
}

export function assertExternalArchiveDestination(outputDirectory, repositoryRoot) {
  const output = resolve(outputDirectory)
  const repository = resolve(repositoryRoot)
  const repositoryPrefix = repository.endsWith(sep) ? repository : `${repository}${sep}`

  if (output === repository || output.startsWith(repositoryPrefix)) {
    throw new Error('Manifest archives must be written outside the Git repository.')
  }

  return output
}

export function validateArchiveReceipt(receipt) {
  if (!receipt || receipt.format !== MANIFEST_ARCHIVE_FORMAT) {
    throw new Error(`Archive receipt must use ${MANIFEST_ARCHIVE_FORMAT}.`)
  }
  if (!Array.isArray(receipt.tables) || receipt.tables.length !== 2) {
    throw new Error('Archive receipt must describe exactly two source tables.')
  }

  const expectedTables = new Set(['manifests', 'manifest_history'])
  for (const table of receipt.tables) {
    if (!expectedTables.delete(table?.table)) throw new Error('Archive receipt contains an unexpected table.')
    if (!Number.isSafeInteger(table.rowCount) || table.rowCount < 0) {
      throw new Error(`Archive receipt has an invalid row count for ${table.table}.`)
    }
    if (!/^[a-f0-9]{64}$/.test(table.sha256 ?? '')) {
      throw new Error(`Archive receipt has an invalid SHA-256 checksum for ${table.table}.`)
    }
    if (table.file !== `${table.table}.jsonl`) {
      throw new Error(`Archive receipt has an invalid file name for ${table.table}.`)
    }
  }
  if (expectedTables.size > 0) throw new Error('Archive receipt is missing a required source table.')

  return receipt
}
