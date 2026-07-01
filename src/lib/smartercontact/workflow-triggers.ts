/**
 * Workflow reply-stop trigger.
 *
 * Standard drip behavior: when a contact replies, stop their active workflow
 * enrollments so an automated sequence never talks over a live conversation.
 * Self-contained and safe to call fire-and-forget from the inbound bridge.
 */
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function stopWorkflowsOnReply(phone: string): Promise<void> {
  const db = supabaseAdmin()
  await db
    .from('sc_workflow_enrollments')
    .update({ status: 'stopped', completed_at: new Date().toISOString() })
    .eq('phone', phone)
    .eq('status', 'active')
}
