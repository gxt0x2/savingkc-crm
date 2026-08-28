export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminOrSecret, requireUserOrSecret } from '@/lib/api/admin-auth'
import {
  DealLedgerError,
  listDealLedgerLines,
  postDealLedgerLine,
} from '@/lib/server/deal-ledger'

const noStore = { 'Cache-Control': 'private, no-store, max-age=0' }

const postSchema = z
  .object({
    lead_id: z.string().uuid().optional(),
    file_number: z.string().trim().min(1).max(80).optional(),
    property_address: z.string().trim().min(1).max(200).optional(),
    amount: z.coerce.number().positive().finite().max(100_000_000),
    direction: z.enum(['in', 'out']),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.string().trim().min(1).max(200),
    memo: z.string().trim().max(1000).nullable().optional(),
    category: z.enum(['assignment_fee', 'transaction_fee', 'emd', 'overhead', 'other']),
    idempotency_key: z.string().trim().min(8).max(200).optional(),
    actor: z.string().trim().min(1).max(120).optional(),
  })
  .refine((value) => Boolean(value.lead_id || value.file_number || value.property_address), {
    message: 'deal_key_required',
  })

function fail(error: unknown) {
  if (error instanceof DealLedgerError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore })
  }
  console.error('[deal-ledger] unexpected error', error)
  return NextResponse.json({ error: 'Deal File ledger is unavailable.' }, { status: 503, headers: noStore })
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const url = new URL(request.url)
    const lines = await listDealLedgerLines({
      leadId: url.searchParams.get('lead_id'),
      fileNumber: url.searchParams.get('file_number'),
      tcFileId: url.searchParams.get('tc_file_id'),
    })
    return NextResponse.json({ lines }, { headers: noStore })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAdminOrSecret(request)
  if (unauthorized) return unauthorized

  try {
    const parsed = postSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Ledger line is invalid.', code: 'invalid' }, { status: 400, headers: noStore })
    }
    const body = parsed.data
    const result = await postDealLedgerLine({
      leadId: body.lead_id,
      fileNumber: body.file_number,
      propertyAddress: body.property_address,
      amount: body.amount,
      direction: body.direction,
      postedOn: body.date,
      source: body.source,
      memo: body.memo,
      category: body.category,
      idempotencyKey: body.idempotency_key,
      actor: body.actor ?? 'treasury',
    })
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers: noStore })
  } catch (error) {
    return fail(error)
  }
}
