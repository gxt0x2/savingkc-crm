// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EmailCallbackReview } from './email-callback-review'

afterEach(cleanup)
const props = { request: { messageId: 'test', phone: '816-555-0101', testOnly: true, reviewed: false }, stopped: true, canWork: true, owns: true, blocked: false, busy: false, onApprove: vi.fn(), onTakeOver: vi.fn(), onBackToInbox: vi.fn() }
it('explains the test outcome before approval and shows saving feedback', () => {
  const { rerender } = render(<EmailCallbackReview {...props} />)
  expect(screen.getByText(/Finish the test to move/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Finish test' }))
  expect(props.onApprove).toHaveBeenCalledOnce()
  rerender(<EmailCallbackReview {...props} busy blocked />)
  expect(screen.getByRole('button', { name: 'Saving…' }).hasAttribute('disabled')).toBe(true)
})
it('replaces the action with completion and a working inbox exit', () => {
  render(<EmailCallbackReview {...props} request={{ ...props.request, reviewed: true }} />)
  expect(screen.getByRole('status').textContent).toContain('Moved to Done')
  expect(screen.queryByRole('button', { name: 'Finish test' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Back to inbox' }))
  expect(props.onBackToInbox).toHaveBeenCalledOnce()
})
