#!/usr/bin/env node

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { once } from 'node:events'
import { basename, join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  MANIFEST_ARCHIVE_FORMAT,
  archiveLine,
  assertExternalArchiveDestination,
  assertExpectedSupabaseProject,
  createArchiveDigest,
  stableJson,
  withArchiveReadRetries,
} from './manifest-archive-format.mjs'

const TABLES = ['manifests', 'manifest_history']
const repositoryRoot = resolve(import.meta.dirname, '../..')

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function requiredOption(name) {
  const value = option(name)
  if (!value) throw new Error(`Missing required ${name} option.`)
  return value
}

function safeTimestamp() {
  return new Date().toISOString().replaceAll(':', '').replaceAll('.', '')
}

async function exactCount(supabase, table) {
  const { count, error } = await withArchiveReadRetries(
    () => supabase.from(table).select('id', { count: 'exact', head: true }),
  )
  if (error) throw new Error(`Could not count ${table}: ${error.code ?? 'query_failed'} ${error.message ?? ''}`.trim())
  return count ?? 0
}

async function writeRow(stream, row) {
  if (!stream.write(archiveLine(row), 'utf8')) await once(stream, 'drain')
}

async function exportTable(supabase, table, archiveDirectory, pageSize) {
  const expectedBefore = await exactCount(supabase, table)
  const finalPath = join(archiveDirectory, `${table}.jsonl`)
  const temporaryPath = `${finalPath}.partial`
  const fileDescriptor = openSync(temporaryPath, 'wx', 0o600)
  const stream = createWriteStream(temporaryPath, { fd: fileDescriptor, encoding: 'utf8', autoClose: true })
  const digest = createArchiveDigest()
  let offset = 0

  try {
    while (true) {
      const rangeEnd = offset + pageSize - 1
      const { data, error } = await withArchiveReadRetries(
        () => supabase
          .from(table)
          .select('*')
          .order('id', { ascending: true })
          .range(offset, rangeEnd),
      )

      if (error) {
        throw new Error(
          `Could not export ${table} rows ${offset}-${rangeEnd}: ${error.code ?? 'query_failed'} ${error.message ?? ''}`.trim(),
        )
      }
      const rows = data ?? []
      for (const row of rows) {
        digest.update(row)
        await writeRow(stream, row)
      }
      offset += rows.length
      if (rows.length < pageSize) break
    }

    stream.end()
    await once(stream, 'close')

    const result = digest.finish()
    const expectedAfter = await exactCount(supabase, table)
    if (expectedBefore !== expectedAfter || result.rowCount !== expectedAfter) {
      throw new Error(`${table} changed while the archive was being exported; discard and retry.`)
    }

    renameSync(temporaryPath, finalPath)
    return { table, file: basename(finalPath), ...result }
  } catch (error) {
    stream.destroy()
    rmSync(temporaryPath, { force: true })
    throw error
  }
}

async function main() {
  const requestedOutputParent = resolve(requiredOption('--output-dir'))
  if (!existsSync(requestedOutputParent) || !statSync(requestedOutputParent).isDirectory()) {
    throw new Error('--output-dir must be an existing approved directory.')
  }
  const outputParent = assertExternalArchiveDestination(realpathSync(requestedOutputParent), repositoryRoot)
  const requestedPageSize = Number(option('--page-size') ?? '250')
  if (!Number.isSafeInteger(requestedPageSize) || requestedPageSize < 1 || requestedPageSize > 1000) {
    throw new Error('--page-size must be an integer between 1 and 1000.')
  }

  const sourceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!sourceUrl || !serviceKey) throw new Error('Supabase URL and service credential are required.')
  const projectRef = assertExpectedSupabaseProject(sourceUrl, requiredOption('--project-ref'))

  const archiveDirectory = join(outputParent, `savingkc-manifest-archive-${safeTimestamp()}`)
  mkdirSync(archiveDirectory, { mode: 0o700 })

  const supabase = createClient(sourceUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-client-info': 'savingkc-manifest-archive-export-v1' } },
  })

  try {
    const tables = []
    for (const table of TABLES) {
      tables.push(await exportTable(supabase, table, archiveDirectory, requestedPageSize))
    }

    const receipt = {
      format: MANIFEST_ARCHIVE_FORMAT,
      generatedAt: new Date().toISOString(),
      sourceProjectRef: projectRef,
      tables,
    }
    writeFileSync(join(archiveDirectory, 'receipt.json'), `${stableJson(receipt)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    process.stdout.write(`${stableJson({ ok: true, archiveDirectory, tables })}\n`)
  } catch (error) {
    rmSync(archiveDirectory, { recursive: true, force: true })
    throw error
  }
}

main().catch((error) => {
  process.stderr.write(`Manifest archive export failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
})
