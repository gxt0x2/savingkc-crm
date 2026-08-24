import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function retiredResponse() {
  return NextResponse.json({
    error: 'The legacy Manifest API is retired. Use canonical contact, activity, enrichment, and governed AI services.',
    code: 'legacy_manifest_api_retired',
    replacements: ['/api/leads', '/api/workers/property-enrichment', '/api/ai/next-action-proposal'],
  }, {
    status: 410,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

export async function GET() {
  return retiredResponse()
}

export async function POST() {
  return retiredResponse()
}
