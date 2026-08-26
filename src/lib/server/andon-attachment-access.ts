import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

type AccessResult =
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; status: 401 | 403 | 404 | 500; error: string }

export async function requireAndonAttachmentOwner(feedbackId: string): Promise<AccessResult> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user?.id || !user.email) return { ok: false, status: 401, error: 'You must be signed in to attach evidence.' }

  const { data: feedback, error } = await supabaseAdmin()
    .from('feedback_submissions')
    .select('id, agent_id')
    .eq('id', feedbackId)
    .maybeSingle()

  if (error) return { ok: false, status: 500, error: 'The Andon could not be verified.' }
  if (!feedback) return { ok: false, status: 404, error: 'Andon not found.' }
  if (feedback.agent_id !== user.id) return { ok: false, status: 403, error: 'Only the agent who raised this Andon can add its initial attachments.' }

  return { ok: true, user: { id: user.id, email: user.email } }
}
