export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  createSubmission,
  archiveSubmission,
  ASSIGNMENT_TEMPLATE_ID,
} from '@/lib/docuseal'
import { docusealUnavailableResponse, isDocusealReady } from '@/lib/docuseal-availability'

function docusealReady() {
  return isDocusealReady({
    enabled: process.env.DOCUSEAL_ENABLED,
    token: process.env.DOCUSEAL_TOKEN,
    webhookSecret: process.env.DOCUSEAL_WEBHOOK_SECRET,
  })
}

// POST /api/offers/[id]/assignment
// Create a DocuSeal assignment submission prefilled from the offer. Does NOT
// email the buyer — returns the Assignee's embed_src so we can iframe the
// preview. User then hits /send to actually invite the buyer, or DELETE to
// cancel.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!docusealReady()) return docusealUnavailableResponse()

  try {
    const { id } = await params
    const db = supabaseAdmin()

    const { data: offer, error } = await db
      .from('buyer_offers')
      .select(
        '*, buyer:buyer_id(id, name, company, email, phone), lead:lead_id(id, property_address, city, state, zip, county)'
      )
      .eq('id', id)
      .single()
    if (error || !offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

    if (offer.status !== 'accepted') {
      return NextResponse.json(
        { error: 'Assignment can only be sent on accepted offers' },
        { status: 400 }
      )
    }
    if (!offer.buyer?.email) {
      return NextResponse.json(
        { error: 'Buyer has no email on file — add one before sending assignment' },
        { status: 400 }
      )
    }
    if (offer.assignment_submission_id) {
      return NextResponse.json(
        { error: 'Assignment already created for this offer', submissionId: offer.assignment_submission_id },
        { status: 409 }
      )
    }

    const today = new Date()
    const effectiveDate = today.toISOString().slice(0, 10)
    const closingDate = offer.close_days
      ? new Date(today.getTime() + Number(offer.close_days) * 86_400_000).toISOString().slice(0, 10)
      : effectiveDate

    const address = [
      offer.lead?.property_address,
      offer.lead?.city,
      offer.lead?.state,
      offer.lead?.zip,
    ].filter(Boolean).join(', ')

    const assigneeName = offer.buyer.name || offer.buyer.company || 'Buyer'
    const assigneeEntity = offer.buyer.company || offer.buyer.name || 'Buyer'

    // Contract reads "$397,000" or "$397,000.50" — commas always, cents only
    // when the amount actually has them. DocuSeal's "number" field type
    // accepts a string value and displays it verbatim.
    const amountNum = Number(offer.offer_amount)
    const hasCents = amountNum % 1 !== 0
    const priceFormatted = amountNum.toLocaleString('en-US', {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: 2,
    })

    // Submitter roles match the DocuSeal template exactly: Assignor, Assignee.
    const submission = await createSubmission({
      templateId: ASSIGNMENT_TEMPLATE_ID,
      sendEmail: false,
      submitters: [
        {
          role: 'Assignor',
          email: 'ernest@savingkc.com',
          name: 'Ernest Dodson',
          external_id: `offer:${offer.id}:assignor`,
          values: {
            'Assignee Name (header)': assigneeName,
            'Property Address': address,
            'Effective Date': effectiveDate,
            'Purchase Price': priceFormatted,
            'Closing Date': closingDate,
          },
        },
        {
          role: 'Assignee',
          email: offer.buyer.email,
          name: assigneeName,
          phone: offer.buyer.phone ?? undefined,
          external_id: `offer:${offer.id}:assignee`,
          values: {
            'Assignee Name (header)': assigneeName,
            'Property Address': address,
            'Effective Date': effectiveDate,
            'Purchase Price': priceFormatted,
            'Closing Date': closingDate,
            'Assignee Entity': assigneeEntity,
            'Printed Name': assigneeName,
            'Email': offer.buyer.email,
            'Phone': offer.buyer.phone || '',
          },
        },
      ],
    })

    const assignee = submission.submitters.find(s => s.role === 'Assignee')
    const assignor = submission.submitters.find(s => s.role === 'Assignor')

    await db
      .from('buyer_offers')
      .update({
        assignment_submission_id: String(submission.id),
        assignment_assignee_submitter_id: assignee ? String(assignee.id) : null,
      })
      .eq('id', offer.id)

    return NextResponse.json({
      submissionId: submission.id,
      assignee: assignee ? {
        id: assignee.id,
        email: assignee.email,
        name: assignee.name,
        embedSrc: assignee.embed_src,
        slug: assignee.slug,
      } : null,
      assignor: assignor ? {
        id: assignor.id,
        embedSrc: assignor.embed_src,
        slug: assignor.slug,
      } : null,
    })
  } catch (err) {
    console.error('[assignment POST] error:', err)
    const msg = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// DELETE /api/offers/[id]/assignment — cancel a preview. Archives the
// DocuSeal submission and clears the tracking fields so the user can retry.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!docusealReady()) return docusealUnavailableResponse()

  try {
    const { id } = await params
    const db = supabaseAdmin()

    const { data: offer } = await db
      .from('buyer_offers')
      .select('id, assignment_submission_id, assignment_sent_at')
      .eq('id', id)
      .single()
    if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    if (offer.assignment_sent_at) {
      return NextResponse.json(
        { error: 'Cannot cancel — already sent to buyer' },
        { status: 400 }
      )
    }
    if (offer.assignment_submission_id) {
      try {
        await archiveSubmission(offer.assignment_submission_id)
      } catch (err) {
        console.error('[assignment DELETE] DocuSeal archive failed:', err)
        // Still clear local state so the user can retry
      }
    }

    await db
      .from('buyer_offers')
      .update({
        assignment_submission_id: null,
        assignment_assignee_submitter_id: null,
      })
      .eq('id', id)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[assignment DELETE] error:', err)
    const msg = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
