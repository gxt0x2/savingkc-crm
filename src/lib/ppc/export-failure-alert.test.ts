import { describe, expect, it } from 'vitest'
import { buildPpcExportFailureAlertMessage, cleanAlertPhone } from './export-failure-alert'

describe('ppc export failure alert', () => {
  it('formats exporter failures into a short Ernest alert', () => {
    const message = buildPpcExportFailureAlertMessage({
      workflow: 'PPC conversion export',
      runId: '123',
      runUrl: 'https://github.com/gxt0x2/savingkc-crm/actions/runs/123',
      reason: 'Scheduled PPC conversion export failed.',
      response: {
        ok: true,
        configured: true,
        scanned: 2,
        claimed: 2,
        sent: 1,
        skipped: 0,
        failed: 1,
        pending: 0,
        missingConfig: [],
        results: [
          {
            id: 'row-1',
            eventName: 'call_connected_5m',
            status: 'failed',
            destinations: [
              {
                destination: 'google_ads',
                status: 'failed',
                detail: 'Google Ads rejected the call conversion',
              },
            ],
          },
        ],
      },
    })

    expect(message).toContain('PPC conversion export failed.')
    expect(message).toContain('failed=1')
    expect(message).toContain('call_connected_5m row-1')
    expect(message).toContain('Run: https://github.com/gxt0x2/savingkc-crm/actions/runs/123')
    expect(message.length).toBeLessThanOrEqual(1400)
  })

  it('normalizes Ernest alert phone values', () => {
    expect(cleanAlertPhone('(816) 226-2552')).toBe('+18162262552')
    expect(cleanAlertPhone('18162262552')).toBe('+18162262552')
    expect(cleanAlertPhone('+18162262552')).toBe('+18162262552')
  })
})
