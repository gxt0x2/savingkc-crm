/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProspectingNotesPanel } from './prospecting-notes-panel'

describe('ProspectingNotesPanel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps seller notes visible and saves from the main calling workspace', async () => {
    const onSaved = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/dialer/sessions/session-1/control/operations') {
        return { ok: true, json: async () => ({ control: { operationActive: init?.method === 'POST' } }) }
      }
      if (url === '/api/prospecting/contact-notes' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ activity: { id: 'note-2' } }) }
      }
      throw new Error(`Unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ProspectingNotesPanel
      leadId={null}
      prospectId="prospect-1"
      campaignMemberId="member-1"
      dialerSessionId="session-1"
      sellerName="Mary Seller"
      notes={[{
        id: 'note-1',
        activity_type: 'note',
        description: 'Daughter handles the estate calls.',
        agent: 'Ernest',
        metadata: { source: 'prospecting_contact_note', contact_name: 'Helen Seller' },
        created_at: '2026-09-03T17:00:00.000Z',
      }]}
      readOnly={false}
      onSaved={onSaved}
    />)

    expect(screen.getByText('Daughter handles the estate calls.')).toBeVisible()
    const note = screen.getByRole('textbox', { name: 'Note for Mary Seller' })
    fireEvent.change(note, { target: { value: 'Call after the title appointment.' } })
    fireEvent.click(within(note.closest('form')!).getByRole('button', { name: 'Save note' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/prospecting/contact-notes', expect.objectContaining({ method: 'POST' })))
    const request = fetchMock.mock.calls.find(([input]) => String(input) === '/api/prospecting/contact-notes')
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      prospectId: 'prospect-1',
      campaignMemberId: 'member-1',
      dialerSessionId: 'session-1',
      contactKey: 'seller:prospect-1',
      contactName: 'Mary Seller',
      relation: 'seller',
      description: 'Call after the title appointment.',
    })
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('shows the complete notes workspace while preventing preview writes', () => {
    render(<ProspectingNotesPanel
      leadId="lead-1"
      prospectId={null}
      campaignMemberId={null}
      dialerSessionId=""
      sellerName="Mary Seller"
      notes={[]}
      readOnly
      onSaved={vi.fn()}
    />)

    expect(screen.getByRole('region', { name: 'Notes' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Note for Mary Seller' })).toBeDisabled()
    expect(screen.getByText(/save only during live calling/i)).toBeVisible()
  })
})
