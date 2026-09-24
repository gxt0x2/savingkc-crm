import { describe, expect, it } from 'vitest'

import { appointmentAgentChoices, appointmentAgentValue } from '@/components/leads/appointment-agents'

describe('appointment agent choices', () => {
  it('keeps Ernest and Casey as the operating roster', () => {
    expect(appointmentAgentChoices('Ernest Dodson').map((choice) => choice.value)).toEqual(['ernest', 'casey'])
    expect(appointmentAgentChoices('Casey Davis').map((choice) => choice.label)).toEqual([
      'Ernest Dodson',
      'Casey Davis',
    ])
    expect(appointmentAgentValue('Ernest', null)).toBe('ernest')
    expect(appointmentAgentValue('Casey Davis', null)).toBe('casey')
    expect(appointmentAgentValue('Casey', 'Ernest Dodson')).toBe('ernest')
  })

  it('includes and defaults to the signed-in user when they are not an acquisitions agent', () => {
    const choices = appointmentAgentChoices('OAuth Review (throwaway)')
    expect(choices.map((choice) => choice.label)).toEqual([
      'OAuth Review (throwaway)',
      'Ernest Dodson',
      'Casey Davis',
    ])
    expect(appointmentAgentValue('OAuth Review (throwaway)', null)).toBe('OAuth Review (throwaway)')
    expect(appointmentAgentValue('OAuth Review (throwaway)', 'ernest')).toBe('ernest')
  })
})
