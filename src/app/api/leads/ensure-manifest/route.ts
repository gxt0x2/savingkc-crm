import { NextResponse } from 'next/server'

/** Compatibility tombstone. Internal legacy readers remain until their data
 * parity slices land, but no caller may create new compatibility state here. */
export async function POST() {
  return NextResponse.json({
    error: 'Manifest bootstrap is retired. Lead intake and enrichment are canonical and automatic.',
    replacement: '/api/workers/property-enrichment',
  }, {
    status: 410,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
