import { describe, expect, it } from 'vitest'
import {
  inboxQueryAllowlisted,
  normalizeInboxBucket,
  queryViewFromWorkspace,
  workspaceViewFromQuery,
} from '../inbox-filters'

describe('inbox filters', () => {
  it('uses a safe focused default', () => {
    expect(normalizeInboxBucket('ai_handling')).toBe('ai_handling')
    expect(normalizeInboxBucket('anything')).toBe('needs_action')
  })
  it('maps exclusive workspace queues onto the allowlisted query views', () => {
    expect(queryViewFromWorkspace('action')).toBe('needs_action')
    expect(queryViewFromWorkspace('scheduled')).toBe('calls_appointments')
    expect(workspaceViewFromQuery('closed_stopped')).toBe('done')
    expect(
      inboxQueryAllowlisted({
        view: 'needs_action',
        controllers: ['human'],
        outcomes: ['unsubscribed'],
      }),
    ).toBe(true)
    expect(inboxQueryAllowlisted({ view: 'secret_queue' })).toBe(false)
  })
})
