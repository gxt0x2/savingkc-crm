import { randomUUID } from 'node:crypto'

/** Dependency-injected so timeout, transient failure and restart behavior are tested without contacting sellers. */
export async function runMojoRecovery({ start, runAttempt, report, retain, sleep,
  stopped = () => false, runId = randomUUID() }) {
  const attempts = []
  let last = null
  for (let attempt = 1; attempt <= 3 && !stopped(); attempt++) {
    if (attempt > 1) await sleep(attempt === 2 ? 15_000 : 45_000)
    if (stopped()) break
    let result = { code: 1, timedOut: false }
    try {
      // Idempotent start also repairs a lost start response or temporary CRM outage.
      await start(runId)
      result = await runAttempt(attempt)
    } catch (error) {
      result = { code: 1, timedOut: false, error: error instanceof Error ? error.message : String(error) }
    }
    attempts.push({ exitCode: result.code, timedOut: result.timedOut })
    last = { runId, status: 'running', attempts: [...attempts], result, completedAt: new Date().toISOString() }
    // The local receipt survives a network loss; recovery never depends on a successful alert transport.
    await retain(last)
    if (stopped()) break
    try {
      const response = await report(runId, attempts)
      last = { ...last, status: response.run.status, server: response }
      await retain(last)
      if (response.run.status === 'recovered') return last
    } catch (error) {
      last.error = error instanceof Error ? error.message : String(error)
      await retain(last)
    }
  }
  last = { ...last, runId, attempts, status: stopped() ? 'interrupted' : 'exhausted' }
  await retain(last)
  return last
}
