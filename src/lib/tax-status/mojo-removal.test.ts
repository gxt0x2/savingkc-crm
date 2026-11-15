import { describe, expect, it } from 'vitest'
import { confirmMojoRemoval, MOJO_CONTACT_WRITE_API } from './mojo-removal'

describe('Mojo removal confirmation', () => {
  it('stamps the CRM only after a person confirms, and does not call Mojo', () => {
    expect(MOJO_CONTACT_WRITE_API).toBeNull()
    expect(confirmMojoRemoval('Casey', new Date('2026-11-15T14:30:00.000Z'))).toEqual({
      status: 'confirmed',
      confirmedAt: '2026-11-15T14:30:00.000Z',
      confirmedBy: 'Casey',
    })
    expect(() => confirmMojoRemoval('  ', new Date())).toThrow('removal_actor_required')
  })
})
