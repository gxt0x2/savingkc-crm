import { ScorecardResultsPage } from '@/components/scorecard/scorecard-results-page'

export default async function ScorecardPage({ searchParams }: { searchParams: Promise<{ review?: string }> }) {
  const { review } = await searchParams
  return <ScorecardResultsPage initialExpandedId={review || null} />
}
