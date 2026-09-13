import { describe, expect, it } from 'vitest'
import {
  inboxQueryAllowlisted,
  queryViewFromWorkspace,
} from '../inbox-filters'

describe('personal inbox views', () => {
  it('keeps saved queries on the allowlist and exclusive queues', () => {
    const query = {
      view: queryViewFromWorkspace('action'),
      controllers: ['human'],
      outcomes: ['unsubscribed'],
    }
    expect(inboxQueryAllowlisted(query)).toBe(true)
    expect(query.view).toBe('needs_action')
    expect(
      inboxQueryAllowlisted({
        view: 'needs_action',
        controllers: ['robot'],
      }),
    ).toBe(false)
  })
})
