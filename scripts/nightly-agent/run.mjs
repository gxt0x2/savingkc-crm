import { appendFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { github } from '../ci/github-api.mjs'
function workflowEnv(name) {
  if (!Object.hasOwn(process.env, name)) return undefined
  return process.env[name]
}
// Create Agent accepts model.id and has no max-duration field. Cancel enforces AGENT_MAX_MINUTES.
export const AGENT_MAX_MINUTES = 30
export const AGENT_MODEL = 'grok-4.7'
export const MAX_DEPTH = 2
export const MIN_POLL_MS = 30_000
export const MAX_CURSOR_RETRIES = 5
export const CURSOR_MIN_INTERVAL_MS = 6_000
export const JOB_TIMEOUT_MINUTES = 40
const ACTIVE = new Set(['CREATING', 'RUNNING', 'WAITING_FOR_BACKGROUND_WORK'])
const FAILING = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale', 'error'])
const OK = new Set(['success', 'neutral', 'skipped'])
export function isAllowedGrokModel(id) {
  const value = String(id ?? '').trim().toLowerCase()
  if (!value || value === 'auto' || value === 'default' || value === 'auto-smart') return false
  return value.startsWith('grok')
}
function modelIdOf(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value?.id === 'string') return value.id.trim()
  if (typeof value?.modelId === 'string') return value.modelId.trim()
  return ''
}
export function reportedModelId(payload) {
  const spots = [payload?.model, payload?.agent?.model, payload?.agent?.modelSelection, payload?.run?.model, payload?.run?.modelSelection]
  return spots.map(modelIdOf).find(Boolean) ?? ''
}
function sameModel(requested, reported) {
  return String(requested).trim().toLowerCase() === String(reported).trim().toLowerCase()
}
function parseDepth(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}
export function parseRetryAfter(header, nowMs) {
  if (header == null || header === '') return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isNaN(date) ? null : Math.max(0, date - nowMs)
}
export function retryDelayMs(attempt, retryAfterHeader, nowMs, random) {
  const header = parseRetryAfter(retryAfterHeader, nowMs)
  if (header != null) return header
  return Math.min(60_000, 1000 * 2 ** attempt) + Math.floor(random() * 1000)
}
function rank(state) {
  if (state === 'failure') return 3
  if (state === 'pending') return 2
  if (state === 'success') return 1
  return 0
}
function checkState(run) {
  const status = String(run?.status ?? '').toLowerCase()
  if (status && status !== 'completed') return 'pending'
  const conclusion = String(run?.conclusion ?? '').toLowerCase()
  if (FAILING.has(conclusion)) return 'failure'
  if (OK.has(conclusion)) return 'success'
  return 'pending'
}
function statusState(status) {
  const state = String(status?.state ?? '').toLowerCase()
  if (state === 'success') return 'success'
  if (state === 'failure' || state === 'error') return 'failure'
  return state === 'pending' ? 'pending' : null
}
export function requiredContexts(rules) {
  if (!Array.isArray(rules)) return null
  const names = []
  for (const rule of rules) {
    if (rule?.type !== 'required_status_checks') continue
    for (const check of rule.parameters?.required_status_checks ?? []) {
      if (typeof check === 'string' && check) names.push(check)
      else if (check?.context) names.push(check.context)
    }
  }
  return names
}
export function classifyMainChecks({ required, checkRuns = [], statuses = [], combinedState = '' }) {
  const scoped = Array.isArray(required)
  const names = scoped ? required : [...new Set([
    ...checkRuns.map((run) => run.name).filter(Boolean),
    ...statuses.map((status) => status.context).filter(Boolean),
  ])]
  const worst = new Map(names.map((name) => [name, 'missing']))
  const consider = (name, state) => {
    if (name && worst.has(name) && state && rank(state) > rank(worst.get(name))) worst.set(name, state)
  }
  for (const run of checkRuns) consider(run.name, checkState(run))
  for (const status of statuses) consider(status.context, statusState(status))
  const failing = [...worst].filter(([, state]) => state === 'failure' || (scoped && state === 'missing')).map(([name]) => name)
  if (!scoped && (combinedState === 'failure' || combinedState === 'error') && failing.length === 0) failing.push('combined')
  if (failing.length) return { state: 'red', failing }
  const pending = [...worst].filter(([, state]) => state === 'pending').map(([name]) => name)
  if (pending.length) return { state: 'pending', failing: [] }
  return { state: 'green', failing: [] }
}
export function buildPrompt({ repo, failing, depth }) {
  const lines = (failing ?? []).slice(0, 40).map((name) => `- ${name}`).join('\n') || '- See the latest commit on main.'
  return [
    `Fix the failing required checks on main for https://github.com/${repo}.`,
    `This is try ${depth} of ${MAX_DEPTH} (depths 0, 1, and 2).`,
    `Failing checks:\n${lines}`,
    'Work on a new branch and open one pull request.',
    'Do not merge, approve, or enable auto-merge.',
    "Leave review to Katherine's gate.",
    'Do not push to main.',
  ].join('\n')
}
export function buildLaunchBody({ repo, prompt, modelId }) {
  if (!isAllowedGrokModel(modelId)) {
    const error = new Error('model_not_allowed')
    error.outcome = 'model_not_allowed'
    throw error
  }
  return {
    prompt: { text: prompt }, model: { id: modelId }, name: 'Nightly main check fix',
    repos: [{ url: `https://github.com/${repo}`, startingRef: 'main' }], autoCreatePR: true, workOnCurrentBranch: false,
  }
}
function pullRequestUrl(run) {
  return (run?.git?.branches ?? []).find((branch) => branch?.prUrl)?.prUrl ?? null
}
export function afterRunDecision({ depth, checksState, timedOut }) {
  if (timedOut && checksState !== 'green') {
    return { outcome: 'timed_out', dispatch: checksState === 'red' && depth < MAX_DEPTH }
  }
  if (checksState === 'green') return { outcome: 'fixed_pr_opened', dispatch: false }
  if (checksState !== 'red') return { outcome: 'still_failing', dispatch: false }
  if (depth >= MAX_DEPTH) return { outcome: 'max_tries_reached', dispatch: false }
  return { outcome: 'still_failing', dispatch: true }
}
export function createCursorRequest({
  fetchImpl = globalThis.fetch,
  apiKey,
  sleep,
  now = () => Date.now(),
  random = Math.random,
  minIntervalMs = CURSOR_MIN_INTERVAL_MS,
}) {
  let nextAt = 0
  return async function cursorRequest(path, { method = 'GET', body } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const slot = Math.max(0, nextAt - now())
      if (slot > 0) await sleep(slot)
      nextAt = now() + minIntervalMs
      const headers = { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`, Accept: 'application/json' }
      if (body) headers['Content-Type'] = 'application/json'
      const response = await fetchImpl(`https://api.cursor.com${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
      const retry = response.status === 429 || response.status >= 500
      if (retry && attempt < MAX_CURSOR_RETRIES) {
        await sleep(retryDelayMs(attempt, response.headers?.get?.('retry-after'), now(), random))
        continue
      }
      const text = await response.text()
      if (retry || response.status < 200 || response.status >= 300) {
        throw new Error(`Cursor API ${response.status} ${path}: ${text.slice(0, 200)}`)
      }
      return text ? JSON.parse(text) : null
    }
  }
}
function createCursor(request) {
  return {
    create: (body) => request('/v1/agents', { method: 'POST', body }),
    getAgent: (id) => request(`/v1/agents/${id}`),
    getRun: (id, runId) => request(`/v1/agents/${id}/runs/${runId}`),
    cancel: (id, runId) => request(`/v1/agents/${id}/runs/${runId}/cancel`, { method: 'POST' }),
  }
}
async function listCheckRuns(githubRequest, repo, sha) {
  const runs = []
  for (let page = 1; page <= 3; page += 1) {
    const batch = (await githubRequest(`/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`))?.check_runs ?? []
    runs.push(...batch)
    if (batch.length < 100) break
  }
  return runs
}
export async function inspectMain(githubRequest, repo) {
  const commit = await githubRequest(`/repos/${repo}/commits/main`)
  let required = null
  try {
    required = requiredContexts(await githubRequest(`/repos/${repo}/rules/branches/main`))
  } catch {
    required = null
  }
  const status = await githubRequest(`/repos/${repo}/commits/${commit.sha}/status`)
  const checkRuns = await listCheckRuns(githubRequest, repo, commit.sha)
  return { sha: commit.sha, ...classifyMainChecks({ required, checkRuns, statuses: status?.statuses ?? [], combinedState: status?.state ?? '' }) }
}
async function watchRun({ cursor, agentId, runId, initial, now, sleep, startedAt, maxMinutes }) {
  const deadline = startedAt + maxMinutes * 60 * 1000
  let run = initial
  while (ACTIVE.has(String(run?.status ?? '').toUpperCase())) {
    if (now() >= deadline) {
      try {
        await cursor.cancel(agentId, runId)
        return { run, timedOut: true, cancelError: null }
      } catch (error) {
        return { run, timedOut: true, cancelError: error.message }
      }
    }
    await sleep(Math.min(MIN_POLL_MS, deadline - now()))
    run = await cursor.getRun(agentId, runId)
  }
  return { run, timedOut: false, cancelError: null }
}
export async function runLoop(options = {}) {
  const readEnv = options.env ?? workflowEnv
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const log = options.log ?? ((line) => console.log(line))
  const writeOutcome = options.writeOutcome ?? ((record) => {
    writeFileSync(readEnv('NIGHTLY_AGENT_OUTCOME_PATH') || 'nightly-agent-outcome.json', `${JSON.stringify(record, null, 2)}\n`)
  })
  const githubRequest = options.github ?? github
  const started = now()
  const depth = parseDepth(readEnv('DEPTH'))
  let agentId = null
  function finish(outcome, fields = {}) {
    const ended = now()
    const record = {
      depth, agentId: fields.agentId ?? agentId, outcome, model: fields.model ?? null,
      startedAt: new Date(started).toISOString(), endedAt: new Date(ended).toISOString(),
      durationSeconds: Math.max(0, Math.round((ended - started) / 1000)),
      prUrl: fields.prUrl ?? null, detail: fields.detail ?? null, redispatched: Boolean(fields.redispatched),
    }
    writeOutcome(record)
    const token = fields.logToken ?? outcome
    log(token)
    const summary = readEnv('GITHUB_STEP_SUMMARY')
    if (summary) appendFileSync(summary, `${token} depth=${record.depth} agent=${record.agentId ?? 'none'} duration=${record.durationSeconds}s\n`)
    return record
  }
  const apiKey = readEnv('CURSOR_API_KEY')
  const enabled = readEnv('NIGHTLY_AGENT_ENABLED') === 'true' && typeof apiKey === 'string' && apiKey !== ''
  if (!enabled) return finish('disabled', { detail: 'NIGHTLY_AGENT_ENABLED is not true or CURSOR_API_KEY is unset' })
  if (depth > MAX_DEPTH) return finish('max_tries_reached', { detail: 'depth above 2' })
  const repo = readEnv('GITHUB_REPOSITORY')
  let checks
  try {
    checks = await inspectMain(githubRequest, repo)
  } catch (error) {
    return finish('api_error', { detail: error.message })
  }
  if (checks.state === 'green') return finish('clear', { detail: checks.sha })
  if (checks.state === 'pending') return finish('clear', { detail: 'pending', logToken: 'pending' })
  const configuredModel = readEnv('AGENT_MODEL')
  const modelId = String(configuredModel == null ? AGENT_MODEL : configuredModel).trim()
  if (!isAllowedGrokModel(modelId)) return finish('model_not_allowed', { model: modelId, detail: 'empty or not a grok id' })
  const cursor = options.cursor ?? createCursor(createCursorRequest({ apiKey, sleep, now, random: options.random ?? Math.random }))
  const requestedMinutes = Number(readEnv('AGENT_MAX_MINUTES') || AGENT_MAX_MINUTES)
  const maxMinutes = Number.isFinite(requestedMinutes) && requestedMinutes > 0 ? requestedMinutes : AGENT_MAX_MINUTES
  let created
  try {
    created = await cursor.create(buildLaunchBody({ repo, modelId, prompt: buildPrompt({ repo, failing: checks.failing, depth }) }))
  } catch (error) {
    return finish(error.outcome === 'model_not_allowed' ? 'model_not_allowed' : 'api_error', { model: modelId, detail: error.message })
  }
  agentId = created?.agent?.id ?? null
  const runId = created?.run?.id ?? created?.agent?.latestRunId ?? null
  let reported = reportedModelId(created)
  try {
    if (!reported && agentId) reported = reportedModelId({ agent: await cursor.getAgent(agentId) }) || reported
    if (!reported && agentId && runId) reported = reportedModelId({ run: await cursor.getRun(agentId, runId) }) || reported
  } catch (error) {
    return finish('api_error', { agentId, model: modelId, detail: error.message })
  }
  if (!agentId || !runId) return finish('api_error', { agentId, model: modelId, detail: 'create response missing agent or run id' })
  if (reported && !sameModel(modelId, reported)) {
    let detail = `reported ${reported}`
    try {
      await cursor.cancel(agentId, runId)
    } catch (error) {
      detail = `${detail}; cancel failed: ${error.message}`
    }
    return finish('model_mismatch', { agentId, model: reported, detail })
  }
  let watched
  try {
    watched = await watchRun({ cursor, agentId, runId, initial: created.run, now, sleep, startedAt: started, maxMinutes })
  } catch (error) {
    return finish('api_error', { agentId, model: modelId, detail: error.message })
  }
  let after
  try {
    after = await inspectMain(githubRequest, repo)
  } catch (error) {
    return finish(watched.timedOut ? 'timed_out' : 'api_error', { agentId, model: modelId, detail: error.message })
  }
  const decision = afterRunDecision({ depth, checksState: after.state, timedOut: watched.timedOut })
  let redispatched = false
  if (decision.dispatch) {
    await githubRequest(`/repos/${repo}/actions/workflows/nightly-agent-loop.yml/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: 'main', inputs: { depth: String(depth + 1), reason: `checks still failing after depth ${depth}` } }),
    })
    redispatched = true
  }
  if (watched.timedOut && depth >= MAX_DEPTH && after.state === 'red') log('max_tries_reached')
  return finish(decision.outcome, {
    agentId,
    model: reported || modelId,
    prUrl: pullRequestUrl(watched.run),
    redispatched,
    detail: watched.cancelError ? `cancel failed: ${watched.cancelError}` : after.sha,
  })
}
export function dryRun() {
  const depths = [0, 1, 2].map((depth) => ({ depth, ...afterRunDecision({ depth, checksState: 'red', timedOut: false }) }))
  return {
    agentMaxMinutes: AGENT_MAX_MINUTES, jobTimeoutMinutes: JOB_TIMEOUT_MINUTES, model: AGENT_MODEL,
    modelField: 'model.id', nativeDurationField: null, pollMs: MIN_POLL_MS,
    capEnforcedBy: 'POST /v1/agents/{id}/runs/{runId}/cancel',
    models: [isAllowedGrokModel('') ? 'allowed' : 'model_not_allowed', isAllowedGrokModel('claude-opus-5') ? 'allowed' : 'model_not_allowed', 'model_mismatch'],
    depths,
    timeout: { ...afterRunDecision({ depth: 0, checksState: 'red', timedOut: true }), capSeconds: AGENT_MAX_MINUTES * 60 },
  }
}
async function main() {
  if (workflowEnv('DRY_RUN') === 'true') console.log(JSON.stringify(dryRun(), null, 2))
  else await runLoop()
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
