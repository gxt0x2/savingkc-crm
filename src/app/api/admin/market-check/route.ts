import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { isUserAdmin } from '@/lib/auth/admin'
import { MarketCheckFileError } from '@/lib/market-check/matrix-csv'
import { runMatrixLoad, syncMarketFlags } from '@/lib/market-check/run'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 30_000_000

async function csvFrom(request: Request): Promise<{ csvText: string; fileName: string }> {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new MarketCheckFileError('Choose the Matrix CSV export.')
    if (file.size > MAX_BYTES) throw new MarketCheckFileError('That Matrix export is larger than 30MB.')
    return { csvText: await file.text(), fileName: file.name || 'matrix.csv' }
  }
  const body = await request.json() as { csv?: unknown; fileName?: unknown }
  const csvText = typeof body.csv === 'string' ? body.csv : ''
  if (!csvText.trim()) throw new MarketCheckFileError('Paste the Matrix CSV export.')
  if (Buffer.byteLength(csvText) > MAX_BYTES) throw new MarketCheckFileError('That Matrix export is larger than 30MB.')
  return { csvText, fileName: typeof body.fileName === 'string' ? body.fileName : 'matrix.csv' }
}

export async function POST(request: Request) {
  const actor = await resolveAuthenticatedActor(request)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isUserAdmin(actor.email))) {
    return NextResponse.json({ error: 'This account cannot load a market check.' }, { status: 403 })
  }
  try {
    const file = await csvFrom(request)
    const db = supabaseAdmin()
    await syncMarketFlags(db)
    const result = await runMatrixLoad(db, { ...file, actor: actor.email })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    if (error instanceof MarketCheckFileError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[market-check] load failed', error)
    return NextResponse.json({ error: 'The market check could not be saved.' }, { status: 503 })
  }
}
