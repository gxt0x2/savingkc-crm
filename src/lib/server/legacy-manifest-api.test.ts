import { describe, expect, it, vi } from 'vitest'
import { legacyManifestJson, recordLegacyManifestApiUse } from '@/lib/server/legacy-manifest-api'

describe('legacy Manifest API deprecation', () => {
  it('marks compatibility responses private and scheduled for retirement', () => {
    const response = legacyManifestJson({ ok: true }, { status: 202 })

    expect(response.status).toBe(202)
    expect(response.headers.get('deprecation')).toBe('true')
    expect(response.headers.get('sunset')).toBe('Wed, 30 Sep 2026 23:59:59 GMT')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('link')).toContain('/api/leads')
  })

  it('records usage without customer identifiers', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    recordLegacyManifestApiUse('PATCH', '/api/manifests/[id]')

    expect(warning).toHaveBeenCalledOnce()
    expect(warning.mock.calls[0]?.[0]).toContain('legacy_manifest_api_invoked')
    expect(warning.mock.calls[0]?.[0]).not.toContain('leadId')
    warning.mockRestore()
  })
})
