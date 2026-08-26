import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import { saveProspectingContactNote, type ProspectingContactNoteInput } from '@/lib/server/prospecting-contact-notes'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })

  try {
    const input = await request.json() as ProspectingContactNoteInput
    return prospectingJson(await saveProspectingContactNote(actor, input), { status: 201 })
  } catch (error) {
    return prospectingError(error)
  }
}
