/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DialerEntry } from './dialer-entry'

vi.mock('@/components/telephony/telephony-bar', () => ({
  SoftphoneCore: (props: { surface: string; presentation: string; pendingSessionId?: string | null }) => (
    <div
      data-testid="softphone-core"
      data-surface={props.surface}
      data-presentation={props.presentation}
      data-session-id={props.pendingSessionId ?? ''}
    />
  ),
}))

describe('dialer entry boundaries', () => {
  it('renders the CRM controller without Prospecting session context', () => {
    render(<DialerEntry surface="crm" open onClose={vi.fn()} pendingSessionId="session-that-must-not-cross" />)

    expect(screen.getByTestId('softphone-core')).toHaveAttribute('data-surface', 'crm')
    expect(screen.getByTestId('softphone-core')).toHaveAttribute('data-presentation', 'modal')
    expect(screen.getByTestId('softphone-core')).toHaveAttribute('data-session-id', '')
  })

  it('renders the Prospecting controller with its durable session', () => {
    render(<DialerEntry surface="prospecting" open onClose={vi.fn()} pendingSessionId="session-1" />)

    expect(screen.getByTestId('softphone-core')).toHaveAttribute('data-surface', 'prospecting')
    expect(screen.getByTestId('softphone-core')).toHaveAttribute('data-presentation', 'workspace')
    expect(screen.getByTestId('softphone-core')).toHaveAttribute('data-session-id', 'session-1')
  })
})
