import { NextResponse } from 'next/server'

/** The broad writer is retired; typed per-contact commands own operator writes. */
export function retiredLegacyLeadsPatchResponse(): NextResponse | null {
  return NextResponse.json({
    success: false,
    error: 'Legacy lead updates are retired. Use a typed per-contact command.',
    code: 'legacy_leads_patch_retired',
  }, {
    status: 410,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      Deprecation: 'true',
    },
  })
}
