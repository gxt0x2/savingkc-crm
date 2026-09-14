import { describe, expect, it } from 'vitest'
import { defaultEmailBackup } from './backup-pairing'

const casey = '253ebc93-15d8-4502-9cc0-5030e49fa4b8'
const ernest = 'e313e282-1c5c-43a7-b504-09d8c69bf389'
const gertha = '51a24f31-0700-437a-bb79-4a293be385c0'
const routing = { acquisitionOwnerId: casey, backupId: ernest }
const members = [{ id: casey }, { id: ernest }, { id: gertha }]

describe('defaultEmailBackup', () => {
  it('pairs Casey with Ernest', () => {
    expect(defaultEmailBackup(casey, routing, members)).toBe(ernest)
  })

  it('pairs Ernest with Casey', () => {
    expect(defaultEmailBackup(ernest, routing, members)).toBe(casey)
  })

  it('uses Ernest as the default for another agent', () => {
    expect(defaultEmailBackup(gertha, routing, members)).toBe(ernest)
  })

  it('never returns an unavailable or self backup', () => {
    expect(defaultEmailBackup(ernest, routing, [{ id: ernest }, { id: gertha }])).toBe(gertha)
    expect(defaultEmailBackup(casey, null, [{ id: casey }])).toBeUndefined()
  })
})
