import { describe, expect, it } from 'vitest'
import { commandAllowedInMode } from '../workflow/mode'
describe('hosted command boundary', () => {
  it('rejects synthetic delivery and inbound for hosted or disabled workspaces', () => {
    for (const mode of ['hosted', 'disabled', 'unknown'])
      for (const action of ['LOCAL-DELIVER', 'LOCAL-INBOUND'])
        expect(commandAllowedInMode(action, mode)).toBe(false)
  })
  it('allows real user work only in configured modes', () => {
    for (const action of ['HAN-SCHEDULE', 'THR-NOTE', 'CAM-CREATE']) {
      expect(commandAllowedInMode(action, 'hosted')).toBe(true)
      expect(commandAllowedInMode(action, 'disabled')).toBe(false)
    }
    expect(commandAllowedInMode('LOCAL-DELIVER', 'simulation')).toBe(true)
  })
})
