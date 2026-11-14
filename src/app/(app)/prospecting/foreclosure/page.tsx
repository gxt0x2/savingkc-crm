import { ForeclosureWorkspace } from '@/components/prospecting/foreclosure-workspace'
import { foreclosureIntakeReviewFixtures } from '@/lib/prospecting/foreclosure-intake'
import { foreclosureSampleContactEnabled } from '@/lib/prospecting/foreclosure-sample'

export const dynamic = 'force-dynamic'

export default function ForeclosurePage() {
  const reviewFixtures = foreclosureSampleContactEnabled() ? foreclosureIntakeReviewFixtures() : []
  return <ForeclosureWorkspace reviewFixtures={reviewFixtures} />
}
