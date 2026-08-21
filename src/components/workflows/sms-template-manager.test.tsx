/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SmsTemplateManager } from './sms-template-manager'

const template = {
  id: 'template-1',
  name: 'heir_intro',
  category: 'prospecting_intro',
  body: 'Hi {firstName}. Reply STOP to opt out.',
  merge_fields: ['{firstName}'],
  usage_count: 4,
}

describe('SmsTemplateManager', () => {
  afterEach(() => vi.restoreAllMocks())

  it('loads reusable SMS templates and opens one for governed editing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ templates: [template] }), { status: 200 }))

    render(<SmsTemplateManager />)

    fireEvent.click(await screen.findByRole('button', { name: /Heir Intro/i }))
    expect(screen.getByLabelText('Template name')).toHaveValue('heir_intro')
    expect(screen.getByLabelText('Message')).toHaveValue(template.body)
    expect(screen.getByText(/Includes STOP opt-out language/)).toHaveTextContent('✓')
  })

  it('publishes reviewed templates to the canonical Conversations library', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ templates: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ template }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ templates: [template] }), { status: 200 }))

    render(<SmsTemplateManager />)
    await screen.findByText('No SMS templates match.')

    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'heir_intro' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: template.body } })
    fireEvent.click(screen.getByRole('button', { name: 'Save SMS template' }))

    expect(await screen.findByText('Template saved and available in Conversations.')).toBeVisible()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const request = fetchMock.mock.calls[1]
    expect(request[0]).toBe('/api/sms-templates')
    expect(request[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      name: 'heir_intro',
      category: 'prospecting_intro',
      merge_fields: ['{firstName}'],
    })
  })

  it('blocks restricted or non-compliant copy before it reaches the API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ templates: [] }), { status: 200 }))
    render(<SmsTemplateManager />)
    await screen.findByText('No SMS templates match.')

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Act now for guaranteed results.' } })
    expect(screen.getByRole('button', { name: 'Save SMS template' })).toBeDisabled()
    expect(screen.getByText(/No restricted urgency or guarantee language/)).toHaveTextContent('○')
    expect(screen.getByText(/Includes STOP opt-out language/)).toHaveTextContent('○')
  })
})
