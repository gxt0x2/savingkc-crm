import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase-lazy', () => ({ supabase: {} }))
import { renderTemplate } from './sms-templates'

describe('SMS phone merge fields', () => {
  it('formats the appointment contact number', () => {
    const body = renderTemplate('appt_confirm_inperson', { firstName: 'Howard', agentName: 'Casey', date: 'Wednesday', time: '1:30 PM', address: '123 Main St', twilioNumber: '+18167277667' })
    expect(body).toContain('(816) 727-7667')
    expect(body).not.toContain('+18167277667')
  })
})
