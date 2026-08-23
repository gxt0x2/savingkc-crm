import { NextResponse } from 'next/server'

const SUNSET_AT = 'Wed, 30 Sep 2026 23:59:59 GMT'

const DEPRECATION_HEADERS = {
  Deprecation: 'true',
  Sunset: SUNSET_AT,
  Warning: '299 - "Legacy Manifest API is compatibility-only; use typed canonical CRM services"',
  Link: '</api/leads>; rel="successor-version"',
  'Cache-Control': 'private, no-store',
} as const

export function recordLegacyManifestApiUse(method: 'GET' | 'POST' | 'PATCH', route: '/api/manifests' | '/api/manifests/[id]') {
  console.warn(JSON.stringify({
    level: 'warning',
    event: 'legacy_manifest_api_invoked',
    method,
    route,
    replacement: 'typed_canonical_crm_services',
    sunsetAt: SUNSET_AT,
  }))
}

export function legacyManifestJson(
  body: unknown,
  init: { status?: number; headers?: HeadersInit } = {},
): NextResponse {
  const headers = new Headers(init.headers)
  for (const [name, value] of Object.entries(DEPRECATION_HEADERS)) headers.set(name, value)
  return NextResponse.json(body, { ...init, headers })
}
