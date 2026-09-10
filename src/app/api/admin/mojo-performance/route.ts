import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'

// Daily totals have one writer: the server's exact-day provider collector.
// Reviewed historical corrections use the digest-gated reconciliation command.
export async function POST(request: NextRequest) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized
  console.warn(JSON.stringify({ event: 'mojo_legacy_performance_writer_rejected' }))
  return NextResponse.json({ error: 'Mojo performance ingestion moved to the scheduled server collector' }, { status: 410 })
}
