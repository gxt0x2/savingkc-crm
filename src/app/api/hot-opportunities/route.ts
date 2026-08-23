import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const RETIRED_RESPONSE = {
  error: 'HOT_OPPORTUNITIES_SURFACE_RETIRED',
  message: 'The duplicate Hot Opps lane was retired. Use Opportunities in Contacts.',
  replacement: '/contacts?list=qualified',
} as const

function retiredResponse() {
  return NextResponse.json(RETIRED_RESPONSE, {
    status: 410,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
    },
  })
}

export async function GET() {
  return retiredResponse()
}

export async function POST() {
  return retiredResponse()
}
