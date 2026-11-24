import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  execute,
  nextFreeVersion,
  reservedPath,
  runCheck,
} from './check-migration-versions.mjs'

const kept = 'supabase/migrations/20260101120000_kept.sql'
const added = 'supabase/migrations/20260101120000_added.sql'
const fresh = 'supabase/migrations/20260102120000_fresh.sql'

test('duplicate-version fails when two files share a 14-digit version', () => {
  const result = runCheck({
    treeFiles: [kept, added],
    baseFiles: [kept],
    addedFiles: [added],
    reserved: [{ version: '20260101120000', pr: 4, owner: 'gxt0x2', note: 'kept' }],
    prNumber: 4,
    otherOpenMigrations: [],
  })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /Duplicate 14-digit migration version 20260101120000/)
  assert.match(result.summary, /failed/i)
})

test('unreserved-version fails when an added version is not reserved for this PR', () => {
  const result = runCheck({
    treeFiles: [fresh],
    baseFiles: [],
    addedFiles: [fresh],
    reserved: [{ version: '20260102120000', pr: 8, owner: 'gxt0x2', note: 'other pull request' }],
    prNumber: 4,
    otherOpenMigrations: [],
  })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /not reserved in supabase\/migrations\/RESERVED\.json for PR #4/)
})

test('clean case passes when added versions are unique and reserved', () => {
  const result = runCheck({
    treeFiles: [kept, fresh],
    baseFiles: [kept],
    addedFiles: [fresh],
    reserved: [{ version: '20260102120000', pr: 9, owner: 'gxt0x2', note: 'fresh' }],
    prNumber: 9,
    otherOpenMigrations: [{ pr: 3, version: '20260103120000', file: 'supabase/migrations/20260103120000_other.sql' }],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.failures, [])
  assert.match(result.summary, /Migration version check passed/)
})

test('pre-existing duplicate versions are report-only', () => {
  const files = [kept, added]
  const result = runCheck({
    treeFiles: files,
    baseFiles: files,
    addedFiles: [],
    reserved: [],
    prNumber: null,
    otherOpenMigrations: [],
  })
  assert.equal(result.ok, true)
  assert.match(result.reports.join('\n'), /Pre-existing duplicate 14-digit version 20260101120000/)
  assert.match(result.summary, /reported only/)
})

test('historical short versions are not 14-digit duplicates', () => {
  const result = runCheck({
    treeFiles: [
      'supabase/migrations/001_initial_schema.sql',
      'supabase/migrations/001_add_housing_details.sql',
      'supabase/migrations/20260408_sms_delivery_tracking.sql',
      'supabase/migrations/20260408_missed_call_tracking.sql',
    ],
    baseFiles: [],
    addedFiles: [],
    reserved: [],
    prNumber: null,
    otherOpenMigrations: [],
  })
  assert.equal(result.ok, true)
  assert.match(result.summary, /No duplicate 14-digit migration versions/)
})

test('an added version collides with another open pull request', () => {
  const result = runCheck({
    treeFiles: [fresh],
    baseFiles: [],
    addedFiles: [fresh],
    reserved: [{ version: '20260102120000', pr: 9, owner: 'gxt0x2', note: 'fresh' }],
    prNumber: 9,
    otherOpenMigrations: [{ pr: 3, version: '20260102120000', file: 'supabase/migrations/20260102120000_other.sql' }],
  })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /open PR #3/)
})

test('next free version is one second after the max timestamp', () => {
  assert.equal(nextFreeVersion(['20261215130000', '20261216120000']), '20261216120001')
  assert.equal(nextFreeVersion(['20261231235959']), '20270101000000')
})

test('reserve appends a null pull request when the owner is unknown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'migration-reserve-'))
  const directory = join(root, 'supabase/migrations')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, '20260101120000_main.sql'), '-- main\n')
  writeFileSync(
    join(root, reservedPath),
    `${JSON.stringify([{ version: '20260301120000', pr: 1, owner: 'gxt0x2', note: 'held' }], null, 2)}\n`,
  )
  execFileSync('git', ['init'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'reserve-test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'reserve-test'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'seed'], { cwd: root })
  execFileSync('git', ['branch', '-M', 'main'], { cwd: root })
  const logs = []
  const code = await execute(
    [
      '--root',
      root,
      '--reserve',
      '--pr',
      'null',
      '--owner',
      'gxt0x2',
      '--note',
      'helper test',
      '--open',
      '[{"pr":2,"version":"20260201120000","file":"supabase/migrations/20260201120000_open.sql"}]',
    ],
    { log: (line) => logs.push(line), error: (line) => logs.push(line) },
  )
  assert.equal(code, 0)
  assert.match(logs[0], /20260301120001/)
  const saved = JSON.parse(readFileSync(join(root, reservedPath), 'utf8'))
  assert.equal(saved.at(-1).version, '20260301120001')
  assert.equal(saved.at(-1).pr, null)
  assert.equal(saved.at(-1).owner, 'gxt0x2')
})
