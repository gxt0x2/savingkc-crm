import { describe, expect, it } from 'vitest'
import {
  CALLER_ID_REST_COMPLIANCE,
  CallerIdUpsertError,
  callerIdActiveTarget,
  callerIdRestUntil,
  dedupeCallerIdDials,
  isCallerIdHealthSlot,
  mojoDialConnected,
  parseCallerIdActiveTarget,
  parseCallerIdUpsert,
  scoreCallerIdPool,
  twilioDialConnected,
  type CallerIdDial,
  type CallerIdRecord,
} from './caller-id-health'

const ACTIVE = '+18166404701'
const SECOND = '+18165788107'
const THIRD = '+18166536616'
const SPARE = '+18164761344'
const HELD = '+18162538313'
const OTHER_AREA = '+19135550100'

const NOW = new Date('2026-11-16T14:05:00.000Z')

function number(phone: string, status: CallerIdRecord['status'], restUntil: string | null = null): CallerIdRecord {
  return { number: phone, areaCode: phone.slice(2, 5), status, restUntil, restReason: status === 'resting' ? 'already resting' : null }
}

function dial(callerId: string, day: string, connected: boolean, source: CallerIdDial['source'] = 'mojo', time = '15:00:00'): CallerIdDial {
  return { callerId, at: `${day}T${time}Z`, connected, source }
}

function many(callerId: string, day: string, count: number, connects: number, source: CallerIdDial['source'] = 'mojo'): CallerIdDial[] {
  return Array.from({ length: count }, (_, index) => dial(
    callerId,
    day,
    index < connects,
    source,
    `${String(14 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00`,
  ))
}

function pool(): CallerIdRecord[] {
  return [number(ACTIVE, 'active'), number(SECOND, 'active'), number(THIRD, 'active'), number(SPARE, 'spare'), number(HELD, 'held')]
}

describe('caller ID connect classification', () => {
  it('treats a Mojo answer, voicemail, or conversation as a connect and a no-answer as a miss', () => {
    expect(mojoDialConnected('Contact', null, 30)).toBe(true)
    expect(mojoDialConnected('Voicemail', null, 12)).toBe(true)
    expect(mojoDialConnected('DNC Contact', null, 8)).toBe(true)
    expect(mojoDialConnected('No Answer', null, 0)).toBe(false)
    expect(mojoDialConnected('No Contact', null, 0)).toBe(false)
    expect(mojoDialConnected('Busy', null, 0)).toBe(false)
    expect(mojoDialConnected('Disconnected', null, 0)).toBe(false)
    expect(mojoDialConnected('Something else', null, 0)).toBe(false)
    expect(mojoDialConnected('Something else', null, 20)).toBe(true)
  })

  it('treats a completed Twilio call with talk time as a connect', () => {
    expect(twilioDialConnected('completed', 8)).toBe(true)
    expect(twilioDialConnected('completed', 0)).toBe(false)
    expect(twilioDialConnected('no-answer', 0)).toBe(false)
    expect(twilioDialConnected('busy', 0)).toBe(false)
    expect(twilioDialConnected('failed', 0)).toBe(false)
    expect(twilioDialConnected('canceled', 0)).toBe(false)
  })
})

describe('caller ID health slot', () => {
  it('matches 8:05am Central on a weekday in both standard and daylight time', () => {
    expect(isCallerIdHealthSlot(new Date('2026-11-16T14:05:00.000Z'))).toBe(true)
    expect(isCallerIdHealthSlot(new Date('2026-11-16T13:05:00.000Z'))).toBe(false)
    expect(isCallerIdHealthSlot(new Date('2026-07-13T13:05:00.000Z'))).toBe(true)
    expect(isCallerIdHealthSlot(new Date('2026-07-13T14:05:00.000Z'))).toBe(false)
    expect(isCallerIdHealthSlot(new Date('2026-11-14T14:05:00.000Z'))).toBe(false)
    expect(isCallerIdHealthSlot(new Date('2026-11-16T14:31:00.000Z'))).toBe(false)
  })
})

describe('scoreCallerIdPool', () => {
  it('rests an active number 15 or more points below the pool after 20 dials and promotes the next clean spare', () => {
    const dials = [
      ...many(ACTIVE, '2026-11-13', 20, 1),
      ...many(SECOND, '2026-11-13', 20, 8),
      ...many(THIRD, '2026-11-13', 20, 8),
    ]
    const plan = scoreCallerIdPool({ now: NOW, numbers: pool(), dials })
    const rest = plan.actions.find((action) => action.type === 'rest')
    const promote = plan.actions.find((action) => action.type === 'promote')
    expect(rest).toMatchObject({ number: ACTIVE, restUntil: callerIdRestUntil(NOW) })
    expect(promote).toMatchObject({ number: SPARE, areaCode: '816', replaces: ACTIVE })
    expect(plan.proposedActiveSet).toEqual([SECOND, SPARE, THIRD].sort())
    expect(plan.actions.some((action) => action.type === 'promote' && action.number === HELD)).toBe(false)
    expect(plan.compliance).toBe(CALLER_ID_REST_COMPLIANCE)
    expect(rest && rest.type === 'rest' ? rest.reason : '').toContain('Not a rotation to evade spam labels')
  })

  it('does not rest a number with 19 dials or a gap under 15 points', () => {
    const short = scoreCallerIdPool({
      now: NOW,
      numbers: pool(),
      dials: [...many(ACTIVE, '2026-11-13', 19, 0), ...many(SECOND, '2026-11-13', 20, 20)],
    })
    expect(short.actions.filter((action) => action.type === 'rest')).toEqual([])

    const close = scoreCallerIdPool({
      now: NOW,
      numbers: pool(),
      dials: [...many(ACTIVE, '2026-11-13', 20, 2), ...many(SECOND, '2026-11-13', 20, 4)],
    })
    expect(close.scores.find((score) => score.number === ACTIVE)?.belowPool).toBe(false)
    expect(close.actions.filter((action) => action.type === 'rest')).toEqual([])
  })

  it('records a cap note above 75 dials in a day and does not rest for the cap', () => {
    const dials = [
      ...many(ACTIVE, '2026-11-13', 76, 30),
      ...many(SECOND, '2026-11-13', 20, 8),
    ]
    const plan = scoreCallerIdPool({ now: NOW, numbers: pool(), dials })
    expect(plan.actions.filter((action) => action.type === 'cap_note').map((action) => action.number)).toEqual([ACTIVE])
    expect(plan.actions.some((action) => action.type === 'rest')).toBe(false)
    expect(plan.proposedActiveSet).toEqual(plan.activeSet)

    const atCap = scoreCallerIdPool({
      now: NOW,
      numbers: pool(),
      dials: [...many(ACTIVE, '2026-11-13', 75, 30), ...many(SECOND, '2026-11-13', 20, 8)],
    })
    expect(atCap.actions.some((action) => action.type === 'cap_note')).toBe(false)
  })

  it('rests for the connect gap and still records the cap note when both are true', () => {
    const plan = scoreCallerIdPool({
      now: NOW,
      numbers: pool(),
      dials: [...many(ACTIVE, '2026-11-13', 76, 0), ...many(SECOND, '2026-11-13', 20, 10)],
    })
    expect(plan.actions.map((action) => action.type)).toEqual(expect.arrayContaining(['cap_note', 'rest', 'promote']))
    expect(plan.proposedActiveSet).not.toContain(ACTIVE)
    expect(plan.proposedActiveSet).toContain(SPARE)
  })

  it('uses the last one to three dialing days and ignores today', () => {
    const plan = scoreCallerIdPool({
      now: NOW,
      numbers: pool(),
      dials: [
        ...many(ACTIVE, '2026-11-10', 20, 10),
        ...many(ACTIVE, '2026-11-12', 20, 10),
        ...many(ACTIVE, '2026-11-13', 20, 10),
        ...many(SECOND, '2026-11-12', 20, 10),
        ...many(SECOND, '2026-11-13', 20, 10),
        ...many(ACTIVE, '2026-11-16', 40, 0),
      ],
    })
    expect(plan.window.dialingDays).toEqual(['2026-11-10', '2026-11-12', '2026-11-13'])
    expect(plan.scores.find((score) => score.number === ACTIVE)?.dials).toBe(60)
    expect(plan.actions.some((action) => action.type === 'rest')).toBe(false)
  })

  it('promotes a same-area spare before any other area, and skips a spare that is below the pool', () => {
    const numbers = [
      number(ACTIVE, 'active'),
      number(SECOND, 'active'),
      number(THIRD, 'active'),
      number(OTHER_AREA, 'spare'),
      number(SPARE, 'spare'),
    ]
    const preferred = scoreCallerIdPool({
      now: NOW,
      numbers,
      dials: [...many(ACTIVE, '2026-11-13', 20, 0), ...many(SECOND, '2026-11-13', 20, 10), ...many(THIRD, '2026-11-13', 20, 10)],
    })
    expect(preferred.actions.find((action) => action.type === 'promote')).toMatchObject({ number: SPARE, areaCode: '816' })
    expect(preferred.proposedActiveSet).not.toContain(OTHER_AREA)

    const fallback = scoreCallerIdPool({
      now: NOW,
      numbers: numbers.filter((row) => row.number !== SPARE),
      dials: [...many(ACTIVE, '2026-11-13', 20, 0), ...many(SECOND, '2026-11-13', 20, 10), ...many(THIRD, '2026-11-13', 20, 10)],
    })
    expect(fallback.actions.find((action) => action.type === 'promote')).toMatchObject({ number: OTHER_AREA, areaCode: '913', replaces: ACTIVE })
    expect(fallback.proposedActiveSet).toEqual([OTHER_AREA, SECOND, THIRD].sort())

    const dirtyLocal = scoreCallerIdPool({
      now: NOW,
      numbers,
      dials: [
        ...many(ACTIVE, '2026-11-13', 20, 0),
        ...many(SECOND, '2026-11-13', 20, 10),
        ...many(THIRD, '2026-11-13', 20, 10),
        ...many(SPARE, '2026-11-13', 20, 0),
      ],
    })
    expect(dirtyLocal.actions.find((action) => action.type === 'promote')).toMatchObject({ number: OTHER_AREA })
    expect(dirtyLocal.proposedActiveSet).not.toContain(SPARE)
  })

  it('uses the configured active target and does not demote a healthy number to get there', () => {
    const wider = scoreCallerIdPool({
      now: NOW,
      numbers: [number(ACTIVE, 'active'), number(SPARE, 'spare'), number(OTHER_AREA, 'spare')],
      dials: [],
      activeTarget: 10,
    })
    expect(wider.activeTarget).toBe(10)
    expect(wider.proposedActiveSet).toEqual([ACTIVE, OTHER_AREA, SPARE].sort())

    const clamped = scoreCallerIdPool({ now: NOW, numbers: pool(), dials: [], activeTarget: 40 })
    expect(clamped.activeTarget).toBe(10)
    expect(scoreCallerIdPool({ now: NOW, numbers: pool(), dials: [] }).activeTarget).toBe(3)
  })

  it('leaves a rested number in place when rest_until passes and does not extend an open rest', () => {
    const elapsed = scoreCallerIdPool({
      now: NOW,
      numbers: [number(ACTIVE, 'resting', '2026-11-01T14:05:00.000Z'), number(SECOND, 'active'), number(THIRD, 'active'), number(SPARE, 'spare')],
      dials: [...many(SECOND, '2026-11-13', 20, 10)],
    })
    expect(elapsed.actions).toEqual([
      expect.objectContaining({ type: 'rest_elapsed_needs_clearance', number: ACTIVE }),
      expect.objectContaining({ type: 'promote', number: SPARE, replaces: null }),
    ])
    expect(elapsed.proposedActiveSet).toEqual([SECOND, SPARE, THIRD].sort())
    expect(elapsed.proposedActiveSet).not.toContain(ACTIVE)

    const stillBad = scoreCallerIdPool({
      now: NOW,
      numbers: [number(ACTIVE, 'resting', '2026-12-01T14:05:00.000Z'), number(SECOND, 'active'), number(THIRD, 'active')],
      dials: [...many(ACTIVE, '2026-11-13', 20, 0), ...many(SECOND, '2026-11-13', 20, 10), ...many(THIRD, '2026-11-13', 20, 10)],
    })
    expect(stillBad.actions.some((action) => action.type === 'rest')).toBe(false)
    expect(stillBad.actions.some((action) => action.type === 'rest_confirmed' && action.number === ACTIVE)).toBe(true)
    expect(stillBad.actions.some((action) => action.type === 'promote')).toBe(false)
  })

  it('counts one call when Mojo and Twilio describe the same minute and prefers the Mojo result', () => {
    const kept = dedupeCallerIdDials([
      dial(ACTIVE, '2026-11-13', true, 'twilio', '15:00:00'),
      dial(ACTIVE, '2026-11-13', false, 'mojo', '15:00:00'),
      dial(SECOND, '2026-11-13', true, 'twilio', '16:00:00'),
    ])
    expect(kept).toEqual([
      expect.objectContaining({ callerId: ACTIVE, connected: false, source: 'mojo' }),
      expect.objectContaining({ callerId: SECOND, source: 'twilio' }),
    ])
  })

  it('loads only a Mojo-verified number and refuses the lines released on 2026-10-30', () => {
    expect(parseCallerIdUpsert({ phone: '(816) 555-0100', status: 'spare', mojoVerified: true })).toMatchObject({
      phone: '+18165550100',
      areaCode: '816',
      status: 'spare',
    })
    expect(callerIdActiveTarget(undefined)).toBe(3)
    expect(callerIdActiveTarget('10')).toBe(10)
    expect(callerIdActiveTarget(11)).toBe(10)
    expect(parseCallerIdActiveTarget(10)).toBe(10)
    for (const phone of ['+18166404701', '+18165788107', '+18166536616', '+18164761344']) {
      expect(() => parseCallerIdUpsert({ phone, status: 'active', mojoVerified: true })).toThrow(CallerIdUpsertError)
    }
    expect(() => parseCallerIdUpsert({ phone: '+18165550100', status: 'active', mojoVerified: false })).toThrow(/Mojo/)
    expect(() => parseCallerIdActiveTarget(11)).toThrow(CallerIdUpsertError)
  })

  it('does not let a held number into the active set or the pool average', () => {
    const plan = scoreCallerIdPool({
      now: NOW,
      numbers: pool(),
      dials: [...many(HELD, '2026-11-13', 40, 0), ...many(ACTIVE, '2026-11-13', 20, 10), ...many(SECOND, '2026-11-13', 20, 10)],
    })
    expect(plan.held.map((row) => row.number)).toEqual([HELD])
    expect(plan.proposedActiveSet).not.toContain(HELD)
    expect(plan.unattributedDials).toBe(0)
    expect(plan.actions.some((action) => action.number === HELD)).toBe(false)
  })
})
