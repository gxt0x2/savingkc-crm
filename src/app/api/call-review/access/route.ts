import { NextResponse } from 'next/server'

import { getCurrentUserEmail, isUserAdmin } from '@/lib/auth/admin'
import { isCallReviewer } from '@/lib/call-review-reviewers'

export async function GET() {
  const email = await getCurrentUserEmail()
  if (!email) return NextResponse.json({ canReviewCalls: false }, { status: 401 })

  const canReviewCalls = isCallReviewer(email) || await isUserAdmin(email)
  return NextResponse.json({ canReviewCalls }, { headers: { 'Cache-Control': 'no-store' } })
}
