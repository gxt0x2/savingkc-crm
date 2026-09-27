export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { handleGmailPubSubPush } from '@/lib/gmail-push'

// POST /api/webhooks/google/gmail
// Google Cloud Pub/Sub push for Gmail users.watch. Auth is OIDC or the
// configured shared secret. Sync now does not use this route.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const result = await handleGmailPubSubPush({
    authorization: req.headers.get('authorization'),
    queryToken: req.nextUrl.searchParams.get('token'),
    headerToken: req.headers.get('x-goog-pubsub-token'),
    body,
  })
  return NextResponse.json(result.body, { status: result.status })
}
