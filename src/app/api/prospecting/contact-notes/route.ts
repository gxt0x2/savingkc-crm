import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import {
  loadProspectingContactNotes,
  saveProspectingContactNote,
  type ProspectingContactNoteInput,
} from '@/lib/server/prospecting-contact-notes'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })

  try {
    const prospectId = new URL(request.url).searchParams.get('prospect_id')
    return prospectingJson(await loadProspectingContactNotes(prospectId))
  } catch (error) {
    return prospectingError(error)
  }
}

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
