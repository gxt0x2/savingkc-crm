// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SmsThreadPanel } from './sms-thread-panel'

describe('SmsThreadPanel communication identity', () => {
  it('keeps the active Dialer session sender ahead of an older thread line', () => {
    render(
      <SmsThreadPanel
        leadId="lead-1"
        leadName="Frank Hausback"
        phone="+19135307378"
        defaultFromPhone="+18163077835"
        activities={[
          {
            id: 'sms-1',
            activity_type: 'sms',
            description: 'Wrong number',
            agent: 'System',
            created_at: '2026-06-18T18:29:14.000Z',
            metadata: {
              direction: 'received',
              from: '+19135307378',
              to: '+18167277667',
            },
          },
        ]}
      />,
    )

    expect(screen.getByRole('combobox')).toHaveValue('+18163077835')
    expect(screen.getByText('Active dialer session')).toBeInTheDocument()
  })
})
