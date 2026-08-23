'use client'

import { DepartmentHandoffQueue } from './department-handoff-queue'
import { MetricStrip } from './workspace-ui'

type MetricItem = {
  label: string
  value: string | number
  icon: string
  tone: 'info' | 'danger' | 'warning' | 'success'
}

export function TcHandoffStrip({ items }: { items: MetricItem[] }) {
  return (
    <>
      <MetricStrip items={items} />
      <DepartmentHandoffQueue
        department="transaction_coordination"
        status="accepted"
        title="Recently received signed assignments"
      />
    </>
  )
}
