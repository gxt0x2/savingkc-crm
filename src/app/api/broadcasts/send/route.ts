export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { safeSendSMS } from '@/lib/safe-communications'
import { BROADCAST_TWILIO_NUMBERS as TWILIO_NUMBERS } from '@/lib/twilio-numbers'

// Round-robin counter for Twilio numbers (resets on restart, fine for this)
let twilioRRIndex = 0
function nextTwilioNumber(): string {
  const num = TWILIO_NUMBERS[twilioRRIndex % TWILIO_NUMBERS.length]
  twilioRRIndex++
  return num.value
}

function trackedDealPageUrl(
  baseUrl: string,
  params: {
    buyerId?: string | null
    broadcastId: string
    recipientId: string
    medium: 'sms' | 'email'
  },
): string {
  if (!baseUrl) return ''
  try {
    const url = new URL(baseUrl)
    if (params.buyerId) url.searchParams.set('buyer_id', params.buyerId)
    url.searchParams.set('broadcast_id', params.broadcastId)
    url.searchParams.set('broadcast_recipient_id', params.recipientId)
    url.searchParams.set('utm_source', 'savingkc')
    url.searchParams.set('utm_medium', params.medium)
    url.searchParams.set('utm_campaign', `deal_broadcast_${params.broadcastId.slice(0, 8)}`)
    return url.toString()
  } catch {
    return baseUrl
  }
}

// ---------------------------------------------------------------------------
// POST /api/broadcasts/send
// Send a broadcast to all recipients via SMS and/or email
// Body: { broadcast_id, sms_body?, email_subject?, email_body? }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { broadcast_id, sms_body, email_subject, email_body } = body

    if (!broadcast_id) {
      return NextResponse.json({ error: 'broadcast_id is required' }, { status: 400 })
    }

    const db = supabaseAdmin()

    // Fetch broadcast with recipients + buyer data
    const { data: broadcast, error: bcError } = await db
      .from('deal_broadcasts')
      .select('*')
      .eq('id', broadcast_id)
      .single()

    if (bcError || !broadcast) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
    }

    if (broadcast.status === 'sent') {
      return NextResponse.json({ error: 'Broadcast already sent' }, { status: 400 })
    }

    // Fetch recipients with buyer info
    const { data: recipients, error: recipError } = await db
      .from('broadcast_recipients')
      .select('*, buyers:buyer_id(*)')
      .eq('broadcast_id', broadcast_id)

    if (recipError || !recipients) {
      return NextResponse.json({ error: 'Failed to fetch recipients' }, { status: 500 })
    }

    const snapshot = broadcast.deal_snapshot || {}
    const address = snapshot.property_address || 'Address TBD'
    const pType = snapshot.property_type || 'Property'
    const arv = snapshot.arv ? `$${Number(snapshot.arv).toLocaleString()}` : 'N/A'
    const price = snapshot.asking_price ? `$${Number(snapshot.asking_price).toLocaleString()}` : 'N/A'
    const beds = snapshot.beds ?? '?'
    const baths = snapshot.baths_full ?? '?'
    const sqft = snapshot.sqft ? Number(snapshot.sqft).toLocaleString() : '?'

    // Find or create deal page URL for this lead
    let dealPageUrl = ''
    const { data: dealPage } = await db
      .from('deal_pages')
      .select('slug')
      .eq('lead_id', broadcast.lead_id)
      .eq('is_active', true)
      .limit(1)
      .single()

    if (dealPage) {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://crm.savingkc.com'
      dealPageUrl = `${baseUrl}/deals/${dealPage.slug}`
    }

    let smsSent = 0
    let emailsSent = 0
    const errors: string[] = []

    // Process each recipient
    for (const recipient of recipients) {
      const buyer = recipient.buyers
      if (!buyer) continue

      const buyerFirst = buyer.first_name || (buyer.name ? buyer.name.split(' ')[0] : 'Investor')
      const smsDealPageUrl = trackedDealPageUrl(dealPageUrl, {
        buyerId: buyer.id,
        broadcastId: broadcast_id,
        recipientId: recipient.id,
        medium: 'sms',
      })
      const emailDealPageUrl = trackedDealPageUrl(dealPageUrl, {
        buyerId: buyer.id,
        broadcastId: broadcast_id,
        recipientId: recipient.id,
        medium: 'email',
      })

      // --- SMS ---
      if (buyer.sms_opted_in && buyer.phone) {
        try {
          const defaultSmsBody = [
            `${buyerFirst}, new deal from Saving KC:`,
            `${address} - ${pType}`,
            `ARV: ${arv} | Price: ${price}`,
            `${beds}bd/${baths}ba | ${sqft}sf`,
            smsDealPageUrl ? `Details: ${smsDealPageUrl}` : '',
            'Reply STOP to opt out',
          ].filter(Boolean).join('\n')

          const messageBody = sms_body
            ? sms_body
                .replace('{buyerFirst}', buyerFirst)
                .replace('{address}', address)
                .replace('{type}', pType)
                .replace('{arv}', arv)
                .replace('{price}', price)
                .replace('{beds}', String(beds))
                .replace('{baths}', String(baths))
                .replace('{sqft}', sqft)
                .replace('{dealPageUrl}', smsDealPageUrl)
            : defaultSmsBody

          await safeSendSMS({
            to: buyer.phone,
            from: nextTwilioNumber(),
            body: messageBody,
          })

          await db
            .from('broadcast_recipients')
            .update({ sms_status: 'sent', sms_sent_at: new Date().toISOString() })
            .eq('id', recipient.id)

          smsSent++
        } catch (smsErr) {
          console.error(`[broadcast send] SMS failed for buyer ${buyer.id}:`, smsErr)
          await db
            .from('broadcast_recipients')
            .update({ sms_status: 'failed' })
            .eq('id', recipient.id)
          errors.push(`SMS to ${buyer.phone} failed`)
        }
      }

      // --- Email ---
      if (buyer.email_opted_in && buyer.email) {
        try {
          const { Resend } = await import('resend')
          const resend = new Resend(process.env.RESEND_API_KEY)
          const fromEmail = process.env.RESEND_FROM_EMAIL || 'ernest@savingkc.com'

          const subject = email_subject
            ? email_subject.replace('{address}', address)
            : `New Investment Opportunity - ${address}`

          const htmlBody = email_body
            ? email_body
                .replace('{buyerFirst}', buyerFirst)
                .replace('{address}', address)
                .replace('{type}', pType)
                .replace('{arv}', arv)
                .replace('{price}', price)
                .replace('{beds}', String(beds))
                .replace('{baths}', String(baths))
                .replace('{sqft}', sqft)
                .replace('{dealPageUrl}', emailDealPageUrl)
            : buildEmailHtml({
                buyerFirst,
                address,
                pType,
                arv,
                price,
                beds: String(beds),
                baths: String(baths),
                sqft,
                dealPageUrl: emailDealPageUrl,
                city: snapshot.city || '',
                state: snapshot.state || 'MO',
              })

          await resend.emails.send({
            from: `Saving KC <${fromEmail}>`,
            to: buyer.email,
            subject,
            html: htmlBody,
          })

          await db
            .from('broadcast_recipients')
            .update({ email_status: 'sent', email_sent_at: new Date().toISOString() })
            .eq('id', recipient.id)

          emailsSent++
        } catch (emailErr) {
          console.error(`[broadcast send] Email failed for buyer ${buyer.id}:`, emailErr)
          await db
            .from('broadcast_recipients')
            .update({ email_status: 'failed' })
            .eq('id', recipient.id)
          errors.push(`Email to ${buyer.email} failed`)
        }
      }
    }

    // Update broadcast stats
    await db
      .from('deal_broadcasts')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        sms_sent: smsSent,
        emails_sent: emailsSent,
      })
      .eq('id', broadcast_id)

    return NextResponse.json({
      success: true,
      broadcast_id,
      sms_sent: smsSent,
      emails_sent: emailsSent,
      total_recipients: recipients.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    console.error('[broadcasts send] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// HTML email template
// ---------------------------------------------------------------------------
function buildEmailHtml(props: {
  buyerFirst: string
  address: string
  pType: string
  arv: string
  price: string
  beds: string
  baths: string
  sqft: string
  dealPageUrl: string
  city: string
  state: string
}): string {
  const { buyerFirst, address, pType, arv, price, beds, baths, sqft, dealPageUrl, city, state } = props
  const location = [city, state].filter(Boolean).join(', ')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:20px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:#1a1a2e;padding:24px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;">Saving KC</h1>
            <p style="margin:4px 0 0;color:#a0a0c0;font-size:13px;">New Investment Opportunity</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:16px;color:#333;">Hey ${buyerFirst},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#555;">We just locked up a new deal and wanted to give you first look:</p>

            <table width="100%" cellpadding="12" cellspacing="0" style="background:#f8f9fa;border-radius:6px;margin-bottom:24px;">
              <tr>
                <td style="border-bottom:1px solid #e9ecef;">
                  <strong style="color:#333;font-size:17px;">${address}</strong><br>
                  <span style="color:#666;font-size:14px;">${location} | ${pType}</span>
                </td>
              </tr>
              <tr>
                <td>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td width="50%" style="padding:8px 0;">
                        <span style="color:#888;font-size:12px;text-transform:uppercase;">ARV</span><br>
                        <strong style="color:#333;font-size:18px;">${arv}</strong>
                      </td>
                      <td width="50%" style="padding:8px 0;">
                        <span style="color:#888;font-size:12px;text-transform:uppercase;">Asking Price</span><br>
                        <strong style="color:#2d6a4f;font-size:18px;">${price}</strong>
                      </td>
                    </tr>
                    <tr>
                      <td colspan="2" style="padding:8px 0 0;color:#555;font-size:14px;">
                        ${beds} Bed / ${baths} Bath &bull; ${sqft} sqft
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            ${dealPageUrl ? `
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:8px 0 24px;">
                <a href="${dealPageUrl}" style="display:inline-block;background:#2d6a4f;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:16px;font-weight:bold;">
                  View Details &amp; Submit Offer
                </a>
              </td></tr>
            </table>` : ''}

            <p style="margin:0;font-size:13px;color:#888;">
              You're receiving this because you're on our buyers list. Reply to this email or call us to discuss.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fa;padding:16px 32px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#aaa;">
              Saving KC &bull; Kansas City, MO<br>
              <a href="mailto:ernest@savingkc.com" style="color:#888;">ernest@savingkc.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
