import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingJson } from '@/lib/api/prospecting-response'
import { ExcessProceedsError, importJacksonExcessProceedsCsv } from '@/lib/server/excess-proceeds'

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
      if (!(file instanceof File)) return prospectingJson({ error: 'Choose a CSV file.', code: 'invalid' }, { status: 400 })
      csv = await file.text()
    } else {
      const body = await request.json() as { csv?: unknown }
      csv = typeof body.csv === 'string' ? body.csv : ''
    }
    if (!csv.trim()) return prospectingJson({ error: 'The CSV is empty.', code: 'invalid' }, { status: 400 })
    return prospectingJson(await importJacksonExcessProceedsCsv(actor, csv))
  } catch (error) {
    if (error instanceof ExcessProceedsError) return prospectingJson({ error: error.message, code: error.code }, { status: error.status })
    console.error('[excess-proceeds] import failed', error)
    return prospectingJson({ error: 'Excess-proceeds import is unavailable.', code: 'unavailable' }, { status: 503 })
  }
}
