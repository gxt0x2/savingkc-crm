import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingJson } from '@/lib/api/prospecting-response'
import { ForeclosureError, importForeclosureCsv } from '@/lib/server/foreclosure-prospects'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const contentType = request.headers.get('content-type') || ''
    let csv = ''
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) return prospectingJson({ error: 'Choose a CSV file.', code: 'invalid_csv' }, { status: 400 })
      csv = await file.text()
    } else {
      const body = await request.json() as { csv?: unknown }
      csv = typeof body.csv === 'string' ? body.csv : ''
    }
    if (!csv.trim()) return prospectingJson({ error: 'The CSV is empty.', code: 'empty_csv' }, { status: 400 })
    return prospectingJson(await importForeclosureCsv(actor, csv))
  } catch (error) {
    if (error instanceof ForeclosureError) return prospectingJson({ error: error.message, code: error.code }, { status: error.status })
    console.error('[foreclosure] import failed', error)
    return prospectingJson({ error: 'Foreclosure import is unavailable.', code: 'foreclosure_unavailable' }, { status: 503 })
  }
}
