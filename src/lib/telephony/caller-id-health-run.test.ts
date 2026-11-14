import { describe, expect, it } from 'vitest'
import type { CallerIdDial, CallerIdHealthAction, CallerIdRecord } from './caller-id-health'
import { runCallerIdHealth, type CallerIdHealthStore } from './caller-id-health-run'

const ACTIVE = '+18166404701'
const SECOND = '+18165788107'
const THIRD = '+18166536616'
const SPARE = '+18164761344'
const MORNING = new Date('2026-11-16T14:05:00.000Z')
const AFTERNOON = new Date('2026-11-16T18:00:00.000Z')

function numbers(): CallerIdRecord[] {
  return [
    { number: ACTIVE, areaCode: '816', status: 'active', restUntil: null, restReason: null },
    { number: SECOND, areaCode: '816', status: 'active', restUntil: null, restReason: null },
    { number: THIRD, areaCode: '816', status: 'active', restUntil: null, restReason: null },
    { number: SPARE, areaCode: '816', status: 'spare', restUntil: null, restReason: null },
  ]
}

function dials(): CallerIdDial[] {
  const rows: CallerIdDial[] = []
  for (let index = 0; index < 20; index += 1) {
    const minute = `${String(14 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`
    rows.push({ callerId: ACTIVE, at: `2026-11-13T${minute}:00.000Z`, connected: false, source: 'mojo' })
    rows.push({ callerId: SECOND, at: `2026-11-13T${minute}:00.000Z`, connected: true, source: 'twilio' })
    rows.push({ callerId: THIRD, at: `2026-11-13T${minute}:00.000Z`, connected: true, source: 'mojo' })
  }
  return rows
}

function memoryStore(seed = numbers(), history = dials()): CallerIdHealthStore & { events: CallerIdHealthAction[] } {
  const rows = seed.map((row) => ({ ...row }))
  const events: CallerIdHealthAction[] = []
  return {
    events,
    async loadNumbers() { return rows.map((row) => ({ ...row })) },
    async loadDials() { return { dials: history, truncated: false } },
    async apply(actions) {
      for (const action of actions) {
        if (action.type === 'rest') {
          const row = rows.find((candidate) => candidate.number === action.number && candidate.status === 'active')
          if (!row) continue
          row.status = 'resting'
          row.restUntil = action.restUntil
          row.restReason = action.reason
        } else if (action.type === 'promote') {
          const row = rows.find((candidate) => candidate.number === action.number && candidate.status === 'spare')
          if (!row) continue
          row.status = 'active'
        }
        events.push(action)
      }
      return rows.filter((row) => row.status === 'active').map((row) => row.number).sort()
    },
  }
}

describe('runCallerIdHealth', () => {
  it('applies a rest and promotion during the Central morning slot and does not do it again', async () => {
    const store = memoryStore()
    const first = await runCallerIdHealth(store, MORNING)
    expect(first.applied).toBe(true)
    expect(first.activeSet).toEqual([SECOND, SPARE, THIRD].sort())
    const restedUntil = store.events.find((action) => action.type === 'rest' && action.number === ACTIVE)
    expect(restedUntil && restedUntil.type === 'rest' ? restedUntil.restUntil : '').toBe('2026-11-30T14:05:00.000Z')

    const second = await runCallerIdHealth(store, new Date('2026-11-16T14:15:00.000Z'))
    expect(second.applied).toBe(true)
    expect(second.activeSet).toEqual(first.activeSet)
    expect(store.events.filter((action) => action.type === 'rest')).toHaveLength(1)
    expect(store.events.filter((action) => action.type === 'promote')).toHaveLength(1)
    const still = (await store.loadNumbers()).find((row) => row.number === ACTIVE)
    expect(still).toMatchObject({ status: 'resting', restUntil: '2026-11-30T14:05:00.000Z' })
  })

  it('does not change the pool outside the morning slot', async () => {
    const store = memoryStore()
    const result = await runCallerIdHealth(store, AFTERNOON)
    expect(result).toMatchObject({ applied: false, skipped: 'outside_ct_morning' })
    expect(result.actions).toEqual([])
    expect(result.proposedActions.some((action) => action.type === 'rest')).toBe(true)
    expect(store.events).toEqual([])
    expect((await store.loadNumbers()).filter((row) => row.status === 'active')).toHaveLength(3)
  })

  it('refuses to rest when the dial read is truncated', async () => {
    const store = memoryStore()
    store.loadDials = async () => ({ dials: dials(), truncated: true })
    await expect(runCallerIdHealth(store, MORNING)).rejects.toMatchObject({ code: 'dial_window_truncated' })
    expect(store.events).toEqual([])
  })
})
