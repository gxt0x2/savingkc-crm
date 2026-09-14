import { describe, expect, it } from 'vitest'
import {
  canRunEmailCommand,
  requireEmailCommand,
  type EmailActor,
} from '../auth'

const actor = (roles: EmailActor['roles']): EmailActor => ({
  subject: '123e4567-e89b-12d3-a456-426614174000',
  email: 'owner@savingkc.com',
  name: 'Owner',
  workspaceId: '123e4567-e89b-12d3-a456-426614174001',
  membershipId: '123e4567-e89b-12d3-a456-426614174002',
  roles,
  revision: 1,
})

describe('Email workspace authorization', () => {
  it('requires a server-resolved active actor', () => {
    expect(() => requireEmailCommand(null, 'SET-PAUSE')).toThrow(
      /verified active/i,
    )
  })
  it('limits configuration and enablement to owners', () => {
    expect(canRunEmailCommand(actor(['owner']), 'SET-ENABLE')).toBe(true)
    expect(canRunEmailCommand(actor(['marketer']), 'SET-ENABLE')).toBe(false)
    expect(() => requireEmailCommand(actor(['reviewer']), 'SET-ROLES')).toThrow(
      /cannot perform/i,
    )
  })
  it('permits an emergency pause to active operational roles but not readers', () => {
    expect(canRunEmailCommand(actor(['marketer']), 'SET-PAUSE')).toBe(true)
    expect(canRunEmailCommand(actor(['reviewer']), 'SET-PAUSE')).toBe(true)
    expect(canRunEmailCommand(actor(['acquisitions']), 'SET-PAUSE')).toBe(true)
    expect(canRunEmailCommand(actor(['reader']), 'SET-PAUSE')).toBe(false)
  })
})

it('denies commands outside the settings authorization surface', () => {
  expect(canRunEmailCommand(actor(['owner']), 'SVC-CONNECT')).toBe(false)
})
