import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function retiredResponse() {
  return NextResponse.json({
    error: 'Production PPC test-data cleanup is retired. Use a reviewed, one-time operations script with an explicit data inventory and rollback plan.',
    code: 'ppc_test_data_cleanup_retired',
  }, { status: 410 })
}

export async function GET() {
  return retiredResponse()
}

export async function DELETE() {
  return retiredResponse()
}
