import { describe, expect, it, vi } from 'vitest'
import { runMojoRecovery } from '../../../scripts/mojo-recovery-cycle.mjs'
function fixture(statuses = ['recovered']) {
  return { start: vi.fn().mockResolvedValue({}), runAttempt: vi.fn().mockResolvedValue({ code: 0, timedOut: false }),
    report: vi.fn().mockImplementation(async () => ({ run: { status: statuses.shift() || 'exhausted' } })),
    retain: vi.fn(), sleep: vi.fn().mockResolvedValue(undefined), runId: '11111111-1111-4111-8111-111111111111' as const }
}
describe('automatic Mojo recovery controller', () => {
  it('recovers a transient failure without waiting for a human or the next 15-minute tick', async () => {
    const f = fixture(['running', 'recovered'])
    f.runAttempt.mockResolvedValueOnce({ code: 1, timedOut: false })
    const result = await runMojoRecovery(f)
    expect(result.status).toBe('recovered')
    expect(result.attempts).toEqual([{ exitCode: 1, timedOut: false }, { exitCode: 0, timedOut: false }])
    expect(f.sleep).toHaveBeenCalledWith(15_000)
    expect(f.runAttempt).toHaveBeenCalledTimes(2)
  })
  it('stops at three attempts and retains failed timeout evidence', async () => {
    const f = fixture(['running','running','exhausted'])
    f.runAttempt.mockResolvedValue({ code: 124, timedOut: true })
    expect((await runMojoRecovery(f)).status).toBe('exhausted')
    expect(f.runAttempt).toHaveBeenCalledTimes(3)
    expect(f.report.mock.calls[2][1]).toHaveLength(3)
    expect(f.sleep.mock.calls.flat()).toEqual([15_000,45_000])
  })
  it('retains locally and retries when the CRM cannot accept a receipt', async () => {
    const f = fixture(['recovered'])
    f.report.mockRejectedValueOnce(new Error('network unavailable'))
    const result = await runMojoRecovery(f)
    expect(result.status).toBe('recovered')
    expect(f.start).toHaveBeenCalledTimes(2)
    expect(f.retain.mock.calls.some(([r]) => r.error === 'network unavailable')).toBe(true)
  })
  it('retrieves a successful run after its acknowledgment is lost without repeating the import', async () => {
    const f = fixture()
    f.start.mockResolvedValueOnce({}).mockResolvedValueOnce({ run: { status: 'recovered', attempts: [{ exitCode: 0, timedOut: false }] }, health: { status: 'clean' } })
    f.report.mockRejectedValueOnce(new Error('acknowledgment lost'))
    const result = await runMojoRecovery(f)
    expect(result.status).toBe('recovered')
    expect(f.runAttempt).toHaveBeenCalledOnce()
    expect(f.report).toHaveBeenCalledOnce()
  })
  it('does not run the importer until the CRM admits the runtime and run', async () => {
    const f = fixture()
    f.start.mockRejectedValue(new Error('old runtime'))
    f.report.mockRejectedValue(new Error('old runtime'))
    expect((await runMojoRecovery(f)).status).toBe('exhausted')
    expect(f.runAttempt).not.toHaveBeenCalled()
  })
  it('does not claim recovery from a zero exit without server verification', async () => {
    const f = fixture(['running','running','exhausted'])
    expect((await runMojoRecovery(f)).status).toBe('exhausted')
  })
  it('does not launch another child after shutdown during backoff', async () => {
    let stopped = false
    const f = { ...fixture(['running']), stopped: () => stopped }
    f.sleep.mockImplementation(async () => { stopped = true })
    expect((await runMojoRecovery(f)).status).toBe('interrupted')
    expect(f.runAttempt).toHaveBeenCalledTimes(1)
  })
})
