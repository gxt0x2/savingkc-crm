import assert from 'node:assert/strict'
import test from 'node:test'
import { workstream } from './github-api.mjs'
import { findOverlaps } from './pr-overlap-guard.mjs'
import { acceptanceText, countChangedLines, isExcludedFromSize, sizeDecision } from './pr-size-gate.mjs'

test('workstream drops the agent id and keeps the job prefix', () => {
  assert.equal(workstream('cursor/calling-pool-v1-8d0d'), 'cursor/calling-pool-v1')
  assert.equal(workstream('cursor/email-ops-secrets-5176'), 'cursor/email-ops-secrets')
  assert.equal(workstream('feat/foreclosure-daily-ingest'), 'feat/foreclosure-daily-ingest')
})

test('overlap matches a shared workstream, half the non-test files, or a migration name', () => {
  const current = {
    number: 10,
    head: 'cursor/calling-pool-v1-aaaa',
    files: [
      'src/pool.ts',
      'src/pool.test.ts',
      'supabase/migrations/20260101120000_pool.sql',
    ],
  }
  const overlaps = findOverlaps(current, [
    current,
    {
      number: 11,
      title: 'same job',
      head: 'cursor/calling-pool-v1-bbbb',
      user: { login: 'gxt0x2' },
      files: ['docs/notes.md'],
    },
    {
      number: 12,
      title: 'half the files',
      head: 'cursor/other-job-cccc',
      user: { login: 'gxt0x2' },
      files: ['src/pool.ts', 'src/pool.test.ts'],
    },
    {
      number: 13,
      title: 'same migration name',
      head: 'cursor/migration-copy-dddd',
      user: { login: 'gxt0x2' },
      files: ['supabase/migrations/20260101120000_pool.sql'],
    },
    {
      number: 14,
      title: 'dependabot',
      head: 'dependabot/npm_and_yarn/left-pad-1.0.0',
      user: { login: 'dependabot[bot]' },
      files: ['src/pool.ts', 'supabase/migrations/20260101120000_pool.sql'],
    },
    {
      number: 15,
      title: 'too little overlap',
      head: 'cursor/unrelated-eeee',
      user: { login: 'gxt0x2' },
      files: ['src/elsewhere.ts'],
    },
  ])
  assert.deepEqual(overlaps.map((item) => item.number), [11, 12, 13])
  assert.match(overlaps[0].reasons.join(' '), /calling-pool-v1/)
  assert.match(overlaps[1].reasons.join(' '), /1\/2 non-test files \(50%\)/)
  assert.match(overlaps[2].reasons.join(' '), /20260101120000_pool\.sql/)
})

test('size counts changed lines outside tests, fixtures, lockfiles, generated files, and docs', () => {
  const total = countChangedLines(
    [
      '10\t2\tsrc/pool.ts',
      '40\t0\tsrc/pool.test.ts',
      '3\t0\tdocs/agent-workflow.md',
      '100\t0\tpackage-lock.json',
      '5\t1\tsrc/generated/types.ts',
      '-\t-\tassets/logo.png',
      '8\t0\tsrc/fixtures/sample.json',
    ].join('\n'),
  )
  assert.equal(total, 12)
  assert.equal(isExcludedFromSize('README.md'), true)
  assert.equal(sizeDecision(400, new Set()).warn, false)
  assert.equal(sizeDecision(401, new Set()).warn, true)
  assert.equal(sizeDecision(800, new Set()).fail, false)
  assert.equal(sizeDecision(801, new Set()).fail, true)
  assert.equal(sizeDecision(801, new Set(['large-pr-approved'])).fail, false)
})

test('acceptance checks are empty until the section has a command', () => {
  const template = ['## Acceptance checks', '', '<!-- exact command and expected result -->', '', '## Out of scope', '', '-'].join('\n')
  assert.equal(acceptanceText(template), '')
  assert.equal(acceptanceText('## Acceptance checks\n\n-\n'), '')
  assert.equal(
    acceptanceText('## Acceptance checks\n\n`node --test scripts/check-migration-versions.test.mjs` exits 0.\n\n## Out of scope\n'),
    '`node --test scripts/check-migration-versions.test.mjs` exits 0.',
  )
})
