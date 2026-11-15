import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  AGENT_MAX_MINUTES,
  AGENT_MODEL,
  JOB_TIMEOUT_MINUTES,
  MAX_CURSOR_RETRIES,
  MIN_POLL_MS,
  afterRunDecision,
  buildLaunchBody,
  classifyMainChecks,
  createCursorRequest,
  dryRun,
  isAllowedGrokModel,
  reportedModelId,
  retryDelayMs,
  runLoop,
} from './run.mjs'

test('allowlist accepts only grok ids', () => {
  assert.equal(isAllowedGrokModel('grok-4.7'), true)
  assert.equal(isAllowedGrokModel('grok-4.5'), true)
  assert.equal(isAllowedGrokModel(''), false)
  assert.equal(isAllowedGrokModel('   '), false)
  assert.equal(isAllowedGrokModel('auto'), false)
  assert.equal(isAllowedGrokModel('default'), false)
  assert.equal(isAllowedGrokModel('claude-opus-5'), false)
  assert.equal(isAllowedGrokModel('composer-2'), false)
  assert.equal(isAllowedGrokModel('cursor-grok-4.6-xhigh'), false)
})

test('launch body always sends the grok model id', () => {
  const body = buildLaunchBody({ repo: 'gxt0x2/savingkc-crm', prompt: 'fix', modelId: AGENT_MODEL })
  assert.equal(body.model.id, 'grok-4.7')
  assert.equal(body.workOnCurrentBranch, false)
  assert.equal(body.autoCreatePR, true)
  assert.equal(Object.hasOwn(body, 'model'), true)
  assert.throws(() => buildLaunchBody({ repo: 'gxt0x2/savingkc-crm', prompt: 'fix', modelId: '' }), /model_not_allowed/)
})

test('depth cap stops at 2 and timeout is the named 30 minute cap', () => {
  assert.deepEqual(afterRunDecision({ depth: 0, checksState: 'red', timedOut: false }), { outcome: 'still_failing', dispatch: true })
  assert.deepEqual(afterRunDecision({ depth: 1, checksState: 'red', timedOut: false }), { outcome: 'still_failing', dispatch: true })
  assert.deepEqual(afterRunDecision({ depth: 2, checksState: 'red', timedOut: false }), { outcome: 'max_tries_reached', dispatch: false })
  assert.equal(afterRunDecision({ depth: 0, checksState: 'green', timedOut: false }).outcome, 'fixed_pr_opened')
  assert.equal(afterRunDecision({ depth: 0, checksState: 'red', timedOut: true }).outcome, 'timed_out')
  assert.equal(AGENT_MAX_MINUTES, 30)
  assert.equal(MIN_POLL_MS, 30_000)
})

test('green required checks are clear and a failing required check is red', () => {
  const green = classifyMainChecks({
    required: ['Quality Gates'],
    checkRuns: [{ name: 'Quality Gates', status: 'completed', conclusion: 'success' }],
    statuses: [],
  })
  assert.equal(green.state, 'green')
  const red = classifyMainChecks({
    required: ['Quality Gates'],
    checkRuns: [
      { name: 'Quality Gates', status: 'completed', conclusion: 'failure' },
      { name: 'optional', status: 'completed', conclusion: 'failure' },
    ],
  })
  assert.deepEqual(red.failing, ['Quality Gates'])
  const pending = classifyMainChecks({
    required: null,
    checkRuns: [{ name: 'Quality Gates', status: 'in_progress', conclusion: null }],
  })
  assert.equal(pending.state, 'pending')
})

test('retries honor Retry-After and stop after 5 retries', async () => {
  assert.equal(retryDelayMs(0, '2', 0, () => 0), 2000)
  assert.equal(retryDelayMs(3, null, 0, () => 0.5), 8000 + 500)
  let clock = 0
  const sleeps = []
  let calls = 0
  const request = createCursorRequest({
    apiKey: 'dry-run',
    now: () => clock,
    random: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
    minIntervalMs: 6000,
    fetchImpl: async () => {
      calls += 1
      const limited = calls === 1
      return {
        status: limited ? 429 : 200,
        headers: { get: () => (limited ? '2' : null) },
        async text() {
          return limited ? '' : '{"ok":true}'
        },
      }
    },
  })
  const body = await request('/v1/models')
  assert.deepEqual(body, { ok: true })
  assert.ok(sleeps.some((ms) => ms >= 2000))

  let failures = 0
  const failing = createCursorRequest({
    apiKey: 'dry-run',
    now: () => clock,
    random: () => 0,
    sleep: async (ms) => {
      clock += ms
    },
    minIntervalMs: 0,
    fetchImpl: async () => {
      failures += 1
      return {
        status: 500,
        headers: { get: () => null },
        async text() {
          return 'nope'
        },
      }
    },
  })
  await assert.rejects(() => failing('/v1/agents'), /Cursor API 500/)
  assert.equal(failures, MAX_CURSOR_RETRIES + 1)
})

function redGithub() {
  return async (path) => {
    if (String(path).endsWith('/dispatches')) return null
    if (String(path).endsWith('/rules/branches/main')) return [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'gate' }] } }]
    if (String(path).endsWith('/commits/main')) return { sha: 'abc123' }
    if (String(path).includes('/check-runs')) return { check_runs: [{ name: 'gate', status: 'completed', conclusion: 'failure' }] }
    if (String(path).endsWith('/status')) return { state: 'failure', statuses: [{ context: 'gate', state: 'failure' }] }
    throw new Error(`unexpected ${path}`)
  }
}

async function loop(values, cursor, github = redGithub()) {
  const calls = []
  const record = await runLoop({
    env: (name) => (Object.hasOwn(values, name) ? values[name] : undefined),
    now: () => 0,
    sleep: async () => {},
    log: () => {},
    writeOutcome: () => {},
    github: async (path, init) => {
      calls.push({ path, init })
      return github(path, init)
    },
    cursor,
  })
  return { record, calls }
}

const enabled = {
  NIGHTLY_AGENT_ENABLED: 'true',
  CURSOR_API_KEY: 'dry-run',
  GITHUB_REPOSITORY: 'gxt0x2/savingkc-crm',
  AGENT_MODEL: AGENT_MODEL,
  AGENT_MAX_MINUTES: '30',
  DEPTH: '0',
}

test('dry-run covers empty model, non-Grok model, and mismatch without calling the API', async () => {
  let created = 0
  const empty = await loop({ ...enabled, AGENT_MODEL: '' }, { create: async () => { created += 1 } })
  assert.equal(empty.record.outcome, 'model_not_allowed')
  const foreign = await loop({ ...enabled, AGENT_MODEL: 'gpt-5.6-sol' }, { create: async () => { created += 1 } })
  assert.equal(foreign.record.outcome, 'model_not_allowed')
  let cancelled = 0
  const mismatch = await loop(enabled, {
    async create(body) {
      created += 1
      assert.equal(body.model.id, 'grok-4.7')
      assert.equal(body.model.id === 'auto', false)
      return { agent: { id: 'bc-1', model: 'composer-2' }, run: { id: 'run-1', status: 'RUNNING' } }
    },
    async cancel() {
      cancelled += 1
    },
  })
  assert.equal(mismatch.record.outcome, 'model_mismatch')
  assert.equal(mismatch.record.agentId, 'bc-1')
  assert.equal(cancelled, 1)
  assert.equal(created, 1)
  assert.equal(reportedModelId({ agent: { model: { id: 'composer-2' } } }), 'composer-2')

  const report = dryRun()
  assert.deepEqual(report.models, ['model_not_allowed', 'model_not_allowed', 'model_mismatch'])
  assert.equal(report.timeout.outcome, 'timed_out')
  assert.equal(report.timeout.capSeconds, AGENT_MAX_MINUTES * 60)
  assert.equal(report.pollMs, MIN_POLL_MS)
  assert.deepEqual(report.depths.map((item) => item.outcome), ['still_failing', 'still_failing', 'max_tries_reached'])
  assert.deepEqual(report.depths.map((item) => item.dispatch), [true, true, false])
  assert.equal(report.nativeDurationField, null)
})

test('the 30 minute wall clock cancels one run and depth 2 does not dispatch', async () => {
  let clock = 0
  let polls = 0
  let cancelled = 0
  const timedOut = await runLoop({
    env: (name) => (Object.hasOwn(enabled, name) ? enabled[name] : undefined),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    log: () => {},
    writeOutcome: () => {},
    github: redGithub(),
    cursor: {
      async create(body) {
        assert.equal(body.model.id, AGENT_MODEL)
        return { agent: { id: 'bc-time', model: { id: AGENT_MODEL } }, run: { id: 'run-time', status: 'RUNNING' } }
      },
      async getRun() {
        polls += 1
        return { id: 'run-time', status: 'RUNNING' }
      },
      async cancel() {
        cancelled += 1
      },
    },
  })
  assert.equal(timedOut.outcome, 'timed_out')
  assert.equal(timedOut.durationSeconds, AGENT_MAX_MINUTES * 60)
  assert.equal(cancelled, 1)
  assert.ok(polls >= 1)
  assert.equal(timedOut.redispatched, true)

  const stopped = await loop({ ...enabled, DEPTH: '2' }, {
    async create() {
      return { agent: { id: 'bc-2', model: { id: AGENT_MODEL } }, run: { id: 'run-2', status: 'FINISHED' } }
    },
  })
  assert.equal(stopped.record.outcome, 'max_tries_reached')
  assert.equal(stopped.calls.some((call) => String(call.path).endsWith('/dispatches')), false)
  const retried = await loop(enabled, {
    async create() {
      return { agent: { id: 'bc-0', model: { id: AGENT_MODEL } }, run: { id: 'run-0', status: 'FINISHED' } }
    },
  })
  assert.equal(retried.record.outcome, 'still_failing')
  const dispatch = retried.calls.find((call) => String(call.path).endsWith('/dispatches'))
  assert.equal(JSON.parse(dispatch.init.body).inputs.depth, '1')
})

test('disabled and clear never launch, and the workflow pins the same caps', async () => {
  let created = 0
  const cursor = { create: async () => { created += 1 } }
  const disabled = await loop({ ...enabled, NIGHTLY_AGENT_ENABLED: 'false' }, cursor, async () => { throw new Error('no github') })
  assert.equal(disabled.record.outcome, 'disabled')
  const clear = await loop(enabled, cursor, async (path) => {
    if (String(path).endsWith('/rules/branches/main')) return []
    if (String(path).endsWith('/commits/main')) return { sha: 'abc123' }
    if (String(path).includes('/check-runs')) return { check_runs: [{ name: 'gate', status: 'completed', conclusion: 'success' }] }
    if (String(path).endsWith('/status')) return { state: 'success', statuses: [{ context: 'gate', state: 'success' }] }
    return null
  })
  assert.equal(clear.record.outcome, 'clear')
  assert.equal(created, 0)

  const workflow = readFileSync(new URL('../../.github/workflows/nightly-agent-loop.yml', import.meta.url), 'utf8')
  assert.match(workflow, /cron: '0 3 \* \* \*'/)
  assert.match(workflow, /9pm CST \/ 10pm CDT/)
  assert.match(workflow, /AGENT_MAX_MINUTES: 30/)
  assert.match(workflow, new RegExp(`AGENT_MODEL: ${AGENT_MODEL}`))
  assert.match(workflow, /timeout-minutes: 40/)
  assert.match(workflow, /group: nightly-agent-loop/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.equal(workflow.includes('pull_request:'), false)
  assert.equal(JOB_TIMEOUT_MINUTES, 40)
})
