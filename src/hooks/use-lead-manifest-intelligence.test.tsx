// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLeadManifestIntelligence } from './use-lead-manifest-intelligence'

afterEach(() => vi.unstubAllGlobals())

describe('lead Manifest intelligence client', () => {
  it('deduplicates server workspace reads and labels compatibility intelligence', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      manifest: { situation: { motivation: { primary: 'Relocation' } } },
      manifestId: 'manifest-1',
      manifestUpdatedAt: '2026-08-23T18:00:00.000Z',
      manifestIntelligenceSource: 'manifest_compatibility',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

    const first = renderHook(() => useLeadManifestIntelligence('lead-1'), { wrapper })
    const second = renderHook(() => useLeadManifestIntelligence('lead-1'), { wrapper })

    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    expect(second.result.current.manifest).toEqual({ situation: { motivation: { primary: 'Relocation' } } })
    expect(first.result.current.source).toBe('manifest_compatibility')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1', { cache: 'no-store' })
  })
})
