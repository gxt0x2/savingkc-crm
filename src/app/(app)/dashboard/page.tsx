import { Suspense } from 'react'

import { AcquisitionsReportsWorkspace } from './components/AcquisitionsReportsWorkspace'

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm font-semibold text-[var(--crm-text-muted)]">Loading reports...</div>}>
      <AcquisitionsReportsWorkspace />
    </Suspense>
  )
}
