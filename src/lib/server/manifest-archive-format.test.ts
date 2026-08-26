import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  MANIFEST_ARCHIVE_FORMAT,
  archiveLine,
  assertExternalArchiveDestination,
  assertExpectedSupabaseProject,
  createArchiveDigest,
  stableJson,
  validateArchiveReceipt,
  withArchiveReadRetries,
} from '../../../scripts/archive/manifest-archive-format.mjs'

describe('Manifest archive format', () => {
  it('serializes nested JSON deterministically without changing array order', () => {
    expect(stableJson({ zebra: 1, alpha: { two: 2, one: 1 }, list: [{ b: 2, a: 1 }, 3] })).toBe(
      '{"alpha":{"one":1,"two":2},"list":[{"a":1,"b":2},3],"zebra":1}',
    )
  })

  it('hashes the exact canonical JSONL bytes and tracks row count', () => {
    const first = createArchiveDigest()
    first.update({ b: 2, a: 1 })
    first.update({ id: 'second' })

    const second = createArchiveDigest()
    second.update({ a: 1, b: 2 })
    second.update({ id: 'second' })

    expect(first.finish()).toEqual(second.finish())
    expect(archiveLine({ b: 2, a: 1 })).toBe('{"a":1,"b":2}\n')
  })

  it('refuses to store a production archive in the Git repository', () => {
    expect(() => assertExternalArchiveDestination('/workspace/crm/artifacts', '/workspace/crm')).toThrow(
      'outside the Git repository',
    )
    expect(assertExternalArchiveDestination('/secure/crm-archive', '/workspace/crm')).toBe('/secure/crm-archive')
  })

  it('binds an export to the explicitly reviewed Supabase project', () => {
    expect(assertExpectedSupabaseProject('https://abcdefgh.supabase.co', 'abcdefgh')).toBe('abcdefgh')
    expect(() => assertExpectedSupabaseProject('https://abcdefgh.supabase.co', 'different')).toThrow(
      'does not match --project-ref',
    )
  })

  it('retries transient archive reads without changing the returned result', async () => {
    const waits: number[] = []
    let attempts = 0
    const result = await withArchiveReadRetries(
      async () => {
        attempts += 1
        return attempts < 3 ? { data: null, error: { code: 'query_failed' } } : { data: [{ id: 'row-1' }], error: null }
      },
      { maxAttempts: 4, baseDelayMs: 25, wait: async (delayMs) => { waits.push(delayMs) } },
    )

    expect(attempts).toBe(3)
    expect(waits).toEqual([25, 50])
    expect(result).toEqual({ data: [{ id: 'row-1' }], error: null })
  })

  it('returns the final database error after exhausting bounded retries', async () => {
    let attempts = 0
    const result = await withArchiveReadRetries(
      async () => ({ data: null, error: { code: `failure-${++attempts}` } }),
      { maxAttempts: 3, baseDelayMs: 0, wait: async () => {} },
    )

    expect(attempts).toBe(3)
    expect(result.error).toEqual({ code: 'failure-3' })
  })

  it('validates the two-table checksum receipt', () => {
    const receipt = {
      format: MANIFEST_ARCHIVE_FORMAT,
      tables: [
        { table: 'manifests', file: 'manifests.jsonl', rowCount: 367, sha256: 'a'.repeat(64) },
        { table: 'manifest_history', file: 'manifest_history.jsonl', rowCount: 10_668, sha256: 'b'.repeat(64) },
      ],
    }
    expect(validateArchiveReceipt(receipt)).toBe(receipt)
    expect(() => validateArchiveReceipt({ ...receipt, tables: receipt.tables.slice(0, 1) })).toThrow('exactly two')
  })

  it('keeps the production exporter read-only and count-reconciled', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/archive/export-manifest-history.mjs'), 'utf8')
    expect(source).toContain(".select('*')")
    expect(source).toContain('expectedBefore !== expectedAfter')
    expect(source).not.toMatch(/\.from\([^)]*\)\s*\.(?:insert|update|upsert|delete)\s*\(/)
  })

  it('verifies the complete archive artifact and rejects tampering', () => {
    const archiveDirectory = mkdtempSync(join(tmpdir(), 'savingkc-manifest-archive-test-'))
    try {
      const sources = {
        manifests: [{ id: 'manifest-1', manifest: { seller: 'fixture' } }],
        manifest_history: [{ id: 'history-1', manifest_id: 'manifest-1', diff: { station: 'new' } }],
      }
      const tables = Object.entries(sources).map(([table, rows]) => {
        const digest = createArchiveDigest()
        for (const row of rows) digest.update(row)
        writeFileSync(join(archiveDirectory, `${table}.jsonl`), rows.map(archiveLine).join(''))
        return { table, file: `${table}.jsonl`, ...digest.finish() }
      })
      writeFileSync(
        join(archiveDirectory, 'receipt.json'),
        `${stableJson({ format: MANIFEST_ARCHIVE_FORMAT, generatedAt: '2026-08-24T00:00:00.000Z', tables })}\n`,
      )

      const verified = spawnSync(
        process.execPath,
        ['scripts/archive/verify-manifest-history.mjs', '--archive-dir', archiveDirectory],
        { cwd: process.cwd(), encoding: 'utf8' },
      )
      expect(verified.status).toBe(0)
      expect(JSON.parse(verified.stdout)).toMatchObject({ ok: true, tables: [{ rowCount: 1 }, { rowCount: 1 }] })

      appendFileSync(join(archiveDirectory, 'manifests.jsonl'), '{}\n')
      const tampered = spawnSync(
        process.execPath,
        ['scripts/archive/verify-manifest-history.mjs', '--archive-dir', archiveDirectory],
        { cwd: process.cwd(), encoding: 'utf8' },
      )
      expect(tampered.status).toBe(1)
      expect(tampered.stderr).toContain('does not match its receipt')
    } finally {
      rmSync(archiveDirectory, { recursive: true, force: true })
    }
  })

  it('fails before credentials when asked to export into the repository', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/archive/export-manifest-history.mjs', '--output-dir', process.cwd(), '--project-ref', 'abcdefgh'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: '',
          SUPABASE_URL: '',
          SUPABASE_SECRET_KEY: '',
          SUPABASE_SERVICE_ROLE_KEY: '',
        },
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('outside the Git repository')
  })
})
