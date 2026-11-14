import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveOauthReviewSandboxLeadId } from '@/lib/auth/oauth-review-sandbox-session'
import { importSourceList } from '@/lib/source-lists/import-source-list'
import { SourceListImportError } from '@/lib/source-lists/csv'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

async function readImport(request: Request) {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      throw new SourceListImportError('Choose a CSV file.', 400, 'invalid_file')
    }
    return {
      listType: String(form.get('listType') || ''),
      county: String(form.get('county') || ''),
      state: String(form.get('state') || ''),
      violationKind: String(form.get('violationKind') || ''),
      pullDate: String(form.get('pullDate') || ''),
      sourceUrl: String(form.get('sourceUrl') || ''),
      notes: String(form.get('notes') || ''),
      fileName: file.name || String(form.get('fileName') || 'upload.csv'),
      csvText: await file.text(),
    }
  }
  const body = await request.json() as Record<string, unknown>
  return {
    listType: typeof body.listType === 'string' ? body.listType : '',
    county: typeof body.county === 'string' ? body.county : '',
    state: typeof body.state === 'string' ? body.state : '',
    violationKind: typeof body.violationKind === 'string' ? body.violationKind : '',
    pullDate: typeof body.pullDate === 'string' ? body.pullDate : '',
    sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : '',
    notes: typeof body.notes === 'string' ? body.notes : '',
    fileName: typeof body.fileName === 'string' ? body.fileName : 'upload.csv',
    csvText: typeof body.csv === 'string' ? body.csv : '',
  }
}

export async function POST(request: Request) {
  const actor = await resolveAuthenticatedActor(request)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await resolveOauthReviewSandboxLeadId(request)) {
    return NextResponse.json({ error: 'This account cannot import source lists' }, { status: 403 })
  }

  try {
    const result = await importSourceList(supabaseAdmin(), actor.email, await readImport(request))
    return NextResponse.json({ success: true, ...result }, { status: 201 })
  } catch (error) {
    if (error instanceof SourceListImportError) {
      return NextResponse.json({ error: error.message, code: error.code, row: error.row ?? null }, { status: error.status })
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid import request', code: 'invalid_request' }, { status: 400 })
    }
    console.error('[source-lists] import failed', error)
    return NextResponse.json({ error: 'The source list could not be saved.', code: 'source_list_unavailable' }, { status: 503 })
  }
}
