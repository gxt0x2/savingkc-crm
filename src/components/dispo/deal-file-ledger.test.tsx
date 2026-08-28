// @vitest-environment jsdom

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DealFileLedger } from './deal-file-ledger'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Deal File ledger panel', () => {
  it('lists posted lines so Close and Treasury can see them on the file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        lines: [
          {
            id: 'line-1',
            lead_id: '2e3b2b37-ebce-4078-86e8-540eab90ad47',
            amount: 20000,
            direction: 'in',
            posted_on: '2026-05-08',
            source: '96a9cd10-4b12-11f1-9150-33da0a1e0aa3',
            memo: 'Alliance National Title assignment fee',
            category: 'assignment_fee',
          },
          {
            id: 'line-2',
            lead_id: '2e3b2b37-ebce-4078-86e8-540eab90ad47',
            amount: 585,
            direction: 'in',
            posted_on: '2026-05-08',
            source: '96a9cd10-4b12-11f1-9150-33da0a1e0aa3',
            memo: 'Alliance National Title transaction fee',
            category: 'transaction_fee',
          },
        ],
      }),
    }))

    render(<DealFileLedger leadId="2e3b2b37-ebce-4078-86e8-540eab90ad47" fileNumber="605807" />)

    expect(await screen.findByText('Assignment fee')).toBeInTheDocument()
    expect(screen.getByText('Transaction fee')).toBeInTheDocument()
    expect(screen.getByText('Net $20,585.00')).toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/deal-ledger?lead_id=2e3b2b37-ebce-4078-86e8-540eab90ad47&file_number=605807',
      expect.objectContaining({ cache: 'no-store' }),
    ))
  })

  it('shows an empty file instead of inventing a spreadsheet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lines: [] }),
    }))
    render(<DealFileLedger leadId="2e3b2b37-ebce-4078-86e8-540eab90ad47" fileNumber="605807" />)
    expect(await screen.findByText('No money posted on this file yet.')).toBeInTheDocument()
  })
})
