import { describe, expect, it, vi } from 'vitest'

import { runPropertyEnrichmentWorker, type PropertyEnrichmentJobClaim } from './crm-property-enrichment-jobs'

const claim: PropertyEnrichmentJobClaim = {
  leadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  revision: 2,
  claimToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

describe('canonical property enrichment worker', () => {
  it('completes a claimed lead only after canonical enrichment succeeds', async () => {
    const dependencies = {
      claim: vi.fn().mockResolvedValue([claim]),
      enrich: vi.fn().mockResolvedValue(undefined),
      finish: vi.fn().mockResolvedValue('completed'),
    }

    await expect(runPropertyEnrichmentWorker(3, dependencies)).resolves.toMatchObject({
      claimed: 1, completed: 1, pending: 0, failed: 0,
    })
    expect(dependencies.enrich).toHaveBeenCalledWith(claim.leadId)
    expect(dependencies.finish).toHaveBeenCalledWith(claim, true, null)
  })

  it('releases a failed provider attempt for durable retry', async () => {
    const dependencies = {
      claim: vi.fn().mockResolvedValue([claim]),
      enrich: vi.fn().mockRejectedValue(new Error('county unavailable')),
      finish: vi.fn().mockResolvedValue('retry'),
    }

    await expect(runPropertyEnrichmentWorker(3, dependencies)).resolves.toMatchObject({
      claimed: 1, completed: 0, pending: 1, failed: 0,
    })
    expect(dependencies.finish).toHaveBeenCalledWith(claim, false, 'county unavailable')
  })

  it('leaves a newer revision pending instead of falsely completing it', async () => {
    const dependencies = {
      claim: vi.fn().mockResolvedValue([claim]),
      enrich: vi.fn().mockResolvedValue(undefined),
      finish: vi.fn().mockResolvedValue('pending'),
    }

    await expect(runPropertyEnrichmentWorker(3, dependencies)).resolves.toMatchObject({
      claimed: 1, completed: 0, pending: 1, failed: 0,
    })
  })
})

