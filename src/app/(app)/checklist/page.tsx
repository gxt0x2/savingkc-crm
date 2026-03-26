'use client'

import { useState } from 'react'
import { SodSection } from '@/components/checklist/sod-section'
import { EodSection } from '@/components/checklist/eod-section'
import { ReflectionModal } from '@/components/checklist/reflection-modal'
import { HistoryTable } from '@/components/checklist/history-table'

export default function ChecklistPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  function handleEodModalClose() {
    setModalOpen(false)
    setRefreshTrigger((n) => n + 1)
  }

  return (
    <div className="max-w-7xl mx-auto px-8 pt-12">
      <div className="mb-12">
        <h1 className="text-4xl font-extrabold tracking-tighter text-primary mb-2">Performance Architecture</h1>
        <p className="text-on-surface-variant font-medium">Daily operational protocol for high-performance deal flow.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <SodSection />
        <EodSection onSubmit={() => setModalOpen(true)} />
      </div>

      <HistoryTable refreshTrigger={refreshTrigger} />

      <ReflectionModal
        open={modalOpen}
        onClose={handleEodModalClose}
      />
    </div>
  )
}
