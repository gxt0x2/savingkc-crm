export const dynamic = 'force-dynamic'

import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ensureTcFileForSignedAssignment } from '@/lib/tc'

function sharedSecretsMatch(supplied: string, expected: string): boolean {
  const suppliedBytes = Buffer.from(supplied, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  if (suppliedBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(suppliedBytes, expectedBytes)
}

// POST /api/docuseal/webhook
// DocuSeal emits events like form.completed, form.viewed, submission.completed.
// We care about the assignee completion and the submission completion — those
// flip the offer's assignment_signed_at + document url.
//
// Configure in DocuSeal: Settings → Webhooks → add
// https://crm.savingkc.com/api/docuseal/webhook with the shared secret
// matching DOCUSEAL_WEBHOOK_SECRET (sent as the Docuseal-Signature header).
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.DOCUSEAL_WEBHOOK_SECRET
    if (!secret?.trim()) {
      return NextResponse.json(
        { error: 'DocuSeal webhook authentication is not configured' },
        { status: 503 },
      )
    }

    const suppliedSecret = req.headers.get('x-docuseal-signature') || req.headers.get('docuseal-signature')
    if (!suppliedSecret || !sharedSecretsMatch(suppliedSecret, secret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const payload = await req.json()
    const event = payload?.event_type as string | undefined
    const data = payload?.data ?? {}
    const submissionId = data.submission_id ?? data.id
    if (!submissionId) {
      return NextResponse.json({ ok: true, skipped: 'no submission id' })
    }

    const db = supabaseAdmin()

    if (event === 'form.completed' || event === 'submission.completed') {
      // A submitter completed OR the whole submission is done. Mark
      // assignment_signed_at whenever the Assignee has completed. Prefer
      // submission.completed for the document url.
      const updates: Record<string, unknown> = {}
      if (data.completed_at || event === 'submission.completed') {
        updates.assignment_signed_at = new Date().toISOString()
      }
      if (data.documents && Array.isArray(data.documents) && data.documents[0]?.url) {
        updates.assignment_document_url = data.documents[0].url
      }
      if (data.audit_log_url) {
        updates.assignment_document_url = data.documents?.[0]?.url || data.audit_log_url
      }
      if (Object.keys(updates).length > 0) {
        await db
          .from('buyer_offers')
          .update(updates)
          .eq('assignment_submission_id', String(submissionId))

        if (updates.assignment_signed_at) {
          await ensureTcFileForSignedAssignment(db, String(submissionId)).catch((err) => {
            console.error('[docuseal webhook] TC file sync failed:', err)
          })
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[docuseal webhook] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
