'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { ViewToggle } from '@/components/pipeline/view-toggle'
import { KanbanBoard } from '@/components/pipeline/kanban-board'
import { ListView } from '@/components/pipeline/list-view'

function PipelineContent() {
  const searchParams = useSearchParams()
  const currentView = searchParams.get('view') === 'list' ? 'list' : 'kanban'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 sm:px-6 lg:px-8 pt-6 pb-4 flex flex-wrap gap-4 justify-between items-end">
        <div>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight mb-2">
            Stage Management
          </h1>
          <p className="text-on-surface-variant font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_rgba(0,110,47,0.4)]" />
            Ari AI: 14 Leads require immediate follow-up in &ldquo;Due Diligence&rdquo;
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle view={currentView} />
          <button className="px-4 py-2 bg-surface-container-high text-on-surface font-semibold rounded-md hover:bg-surface-container-highest transition-colors flex items-center gap-2">
            <Icon name="filter_list" size="text-sm" />
            Filters
          </button>
          <button className="px-4 py-2 bg-primary text-on-primary font-semibold rounded-md hover:opacity-90 transition-all flex items-center gap-2">
            <Icon name="add" size="text-sm" />
            New Lead
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 sm:px-6 lg:px-8 overflow-hidden">
        {currentView === 'kanban' ? <KanbanBoard /> : <ListView />}
      </div>
    </div>
  )
}

export default function PipelinePage() {
  return (
    <Suspense fallback={<div className="p-8 text-on-surface-variant">Loading pipeline...</div>}>
      <PipelineContent />
    </Suspense>
  )
}
