/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DialerMicrophoneControls } from './dialer-microphone-controls'

const testSelectedMicrophone = vi.fn()

vi.mock('@/lib/telephony/selected-microphone', () => ({
  chooseMicrophone: vi.fn(),
  preferredMicrophone: () => 'default',
  testSelectedMicrophone: (...args: unknown[]) => testSelectedMicrophone(...args),
}))

describe('DialerMicrophoneControls', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    testSelectedMicrophone.mockReset()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn(async () => []),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
  })

  it('hides a successful microphone check for the rest of the calling session', async () => {
    testSelectedMicrophone.mockResolvedValue(0.02)
    const { rerender } = render(<DialerMicrophoneControls
      deviceRef={{ current: {} } as never}
      status="ready"
      open
      sessionId="session-1"
      workspace
    />)

    expect(screen.getByRole('region', { name: 'Microphone check' })).toHaveClass('text-[var(--prospecting-text)]')
    fireEvent.click(screen.getByRole('button', { name: 'Test microphone' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Microphone check' })).not.toBeInTheDocument())
    expect(window.sessionStorage.getItem('savingkc:dialer-microphone-check:v1:session-1')).toBe('complete')

    rerender(<DialerMicrophoneControls
      deviceRef={{ current: {} } as never}
      status="ready"
      open
      sessionId="session-2"
      workspace
    />)
    expect(screen.getByRole('region', { name: 'Microphone check' })).toBeVisible()
  })

  it('keeps the check visible when no usable input is detected', async () => {
    testSelectedMicrophone.mockResolvedValue(0.001)
    render(<DialerMicrophoneControls
      deviceRef={{ current: {} } as never}
      status="ready"
      open
      sessionId="session-1"
      workspace
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Test microphone' }))
    expect(await screen.findByText('No usable input signal detected. Select another microphone and test again.')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Microphone check' })).toBeVisible()
  })
})
