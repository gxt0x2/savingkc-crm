/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MessageTemplatePicker } from './message-template-picker'

const templates = [
  { id: '1', name: 'warm_follow_up', category: 'follow_up', body: 'Hi {firstName}, this is {agentName} about {propertyAddress}.', merge_fields: ['firstName', 'agentName', 'propertyAddress'] },
  { id: '2', name: 'appointment_confirm', category: 'appointment', body: 'Hi {firstName}, confirming {date}.', merge_fields: ['firstName', 'date'] },
]

describe('MessageTemplatePicker', () => {
  it('previews actual CRM fields and only fills the composer after selection', () => {
    const onSelect = vi.fn()
    render(<MessageTemplatePicker templates={templates} loading={false} error={null} context={{ fullName: 'Marcus Johnson', agentName: 'Ernest Dodson', propertyAddress: '4821 Woodland Ave' }} onSelect={onSelect} onClose={vi.fn()} />)
    expect(screen.getByText('Hi Marcus, this is Ernest Dodson about 4821 Woodland Ave.')).toBeVisible()
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Warm Follow Up/ }))
    expect(onSelect).toHaveBeenCalledWith('Hi Marcus, this is Ernest Dodson about 4821 Woodland Ave.')
  })

  it('blocks templates whose required context cannot be rendered truthfully', () => {
    render(<MessageTemplatePicker templates={templates} loading={false} error={null} context={{ fullName: 'Marcus Johnson' }} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Warm Follow Up/ })).toBeDisabled()
    expect(screen.getByText(/Needs agent identity, property address/)).toBeVisible()
    expect(screen.getByRole('button', { name: /Appointment Confirm/ })).toBeDisabled()
    expect(screen.getByText(/Needs \{date\}/)).toBeVisible()
  })

  it('searches names, categories, and message text', () => {
    render(<MessageTemplatePicker templates={templates} loading={false} error={null} context={{ fullName: 'Marcus Johnson' }} onSelect={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search message templates' }), { target: { value: 'appointment' } })
    expect(screen.queryByText('Warm Follow Up')).not.toBeInTheDocument()
    expect(screen.getByText('Appointment Confirm')).toBeVisible()
  })
})
