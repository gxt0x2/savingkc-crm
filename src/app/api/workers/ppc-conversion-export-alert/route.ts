import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { buildPpcExportFailureAlertMessage, cleanAlertPhone } from '@/lib/ppc/export-failure-alert'
import { safeSendSMS } from '@/lib/safe-communications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_TWILIO_PHONE = '+18163077835'
const DEFAULT_ERNEST_PHONE = '+19137179716'

async function handle(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const body = await req.json().catch(() => ({}))
  const message = buildPpcExportFailureAlertMessage(body)
  const from = cleanAlertPhone(process.env.TWILIO_PHONE_NUMBER) || DEFAULT_TWILIO_PHONE
  const to = cleanAlertPhone(process.env.PPC_EXPORT_ALERT_PHONE || process.env.ERNEST_PHONE) || DEFAULT_ERNEST_PHONE

  const result = await safeSendSMS({ from, to, body: message })

  return NextResponse.json({
    ok: result.success,
    recipient: 'Ernest',
    status: result.status ?? null,
    sid: result.sid ?? null,
    error: result.error ?? null,
  }, { status: result.success ? 200 : 502 })
}

export async function POST(req: NextRequest) {
  return handle(req)
}
