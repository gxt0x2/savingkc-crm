export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import {
  DOCUSEAL_NO_STORE_HEADERS,
  DOCUSEAL_UNAVAILABLE_MESSAGE,
  isDocusealReady,
} from '@/lib/docuseal-availability'

export async function GET() {
  const enabled = isDocusealReady({
    enabled: process.env.DOCUSEAL_ENABLED,
    token: process.env.DOCUSEAL_TOKEN,
    webhookSecret: process.env.DOCUSEAL_WEBHOOK_SECRET,
  })

  return NextResponse.json(
    {
      enabled,
      message: enabled ? null : DOCUSEAL_UNAVAILABLE_MESSAGE,
    },
    { headers: DOCUSEAL_NO_STORE_HEADERS },
  )
}
