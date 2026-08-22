import { describe, expect, it } from 'vitest'
import { messageTemplateName, renderMessageTemplate } from './message-template'

describe('conversation message templates', () => {
  it('renders supported fields from the actual conversation context', () => {
    expect(renderMessageTemplate(
      'Hi {firstName}, this is {agentName} about {propertyAddress}.',
      { fullName: 'Marcus Johnson', agentName: 'Ernest Dodson', propertyAddress: '4821 Woodland Ave' },
    )).toEqual({
      rendered: 'Hi Marcus, this is Ernest Dodson about 4821 Woodland Ave.',
      missing: [], unsupported: [], ready: true,
    })
  })

  it('never invents generic values for missing or unsupported fields', () => {
    expect(renderMessageTemplate('Hi {firstName}, see you {date} at {propertyAddress}.', { fullName: 'Marcus Johnson' })).toEqual({
      rendered: 'Hi Marcus, see you {date} at {propertyAddress}.',
      missing: ['propertyAddress'], unsupported: ['{date}'], ready: false,
    })
  })

  it('turns storage names into readable labels', () => {
    expect(messageTemplateName('warm_follow_up')).toBe('Warm Follow Up')
  })
})
