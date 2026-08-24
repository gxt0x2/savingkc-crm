#!/usr/bin/env node

import { createReadStream, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'
import { archiveLine, createArchiveDigest, stableJson, validateArchiveReceipt } from './manifest-archive-format.mjs'

function requiredOption(name) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value) throw new Error(`Missing required ${name} option.`)
  return value
}

async function verifyTable(archiveDirectory, expected) {
  const digest = createArchiveDigest()
  const input = createReadStream(join(archiveDirectory, expected.file), { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })

  for await (const line of lines) {
    if (!line) throw new Error(`${expected.file} contains an empty row.`)
    const row = JSON.parse(line)
    if (archiveLine(row) !== `${line}\n`) {
      throw new Error(`${expected.file} is not canonical JSONL.`)
    }
    digest.update(row)
  }

  const actual = digest.finish()
  if (actual.rowCount !== expected.rowCount || actual.sha256 !== expected.sha256) {
    throw new Error(`${expected.file} does not match its receipt.`)
  }
  return { table: expected.table, ...actual }
}

async function main() {
  const archiveDirectory = resolve(requiredOption('--archive-dir'))
  const receipt = validateArchiveReceipt(JSON.parse(readFileSync(join(archiveDirectory, 'receipt.json'), 'utf8')))
  const tables = []
  for (const table of receipt.tables) tables.push(await verifyTable(archiveDirectory, table))
  process.stdout.write(`${stableJson({ ok: true, archiveDirectory, tables })}\n`)
}

main().catch((error) => {
  process.stderr.write(`Manifest archive verification failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
})
