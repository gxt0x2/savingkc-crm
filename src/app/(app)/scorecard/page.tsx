import { notFound, redirect } from 'next/navigation'

import { ScorecardResultsPage } from '@/components/scorecard/scorecard-results-page'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { isCallReviewer } from '@/lib/call-review-reviewers'

export default async function ScorecardPage({ searchParams }: { searchParams: Promise<{ review?: string }> }) {
  const email = await getCurrentUserEmail()
  if (!email) redirect('/login?redirect=/scorecard')
  if (!isCallReviewer(email)) notFound()

  const { review } = await searchParams
  return <ScorecardResultsPage initialExpandedId={review || null} />
}
