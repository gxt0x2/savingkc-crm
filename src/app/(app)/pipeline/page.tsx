'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { ViewToggle } from '@/components/pipeline/view-toggle'
import { KanbanBoard } from '@/components/pipeline/kanban-board'
import { ListView } from '@/components/pipeline/list-view'
import { AddLeadModal } from '@/components/leads/add-lead-modal'

function PipelineContent() {
  const searchParams = useSearchParams()
  const currentView = searchParams.get('view') === 'list' ? 'list' : 'kanban'
  const [showAdd, setShowAdd] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [filterPriority, setFilterPriority] = useState('all')
  const [refreshKey, setRefreshKey] = useState(0)

  function handleLeadAdded() {
    setShowAdd(false)
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="flex flex-col h-full">
      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onSuccess={handleLeadAdded}
        />
      )}

      {/* Header */}
      <div className="px-4 sm:px-6 lg:px-8 pt-6 pb-4 flex flex-wrap gap-4 justify-between items-end">
        <div>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight mb-2">
            Stage Management
          </h1>
          <p className="text-on-surface-variant font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_rgba(0,110,47,0.4)]" />
            Live pipeline — click any card to open the lead record
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle view={currentView} />
          <button
            onClick={() => setShowFilters((f) => !f)}
            className={`px-4 py-2 font-semibold rounded-md transition-colors flex items-center gap-2 ${
              showFilters
                ? 'bg-primary text-white hover:opacity-90'
                : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'
            }`}
          >
            <Icon name="filter_list" size="text-sm" />
            Filters
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-primary text-on-primary font-semibold rounded-md hover:opacity-90 transition-all flex items-center gap-2"
          >
            <Icon name="add" size="text-sm" />
            New Lead
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="px-4 sm:px-6 lg:px-8 pb-3 flex items-center gap-3 flex-wrap border-b border-outline-variant/10 mb-2">
          <span className="text-sm font-semibold text-on-surface-variant">Priority:</span>
          {['all', 'hot', 'high', 'normal'].map((p) => (
            <button
              key={p}
              onClick={() => setFilterPriority(p)}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                filterPriority === p
                  ? 'bg-primary text-white'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {p === 'all' ? 'All' : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
          {filterPriority !== 'all' && (
            <button
              onClick={() => setFilterPriority('all')}
              className="text-xs text-error hover:underline ml-2"
            >
              Clear filter
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 px-4 sm:px-6 lg:px-8 overflow-hidden">
        {currentView === 'kanban' ? (
          <KanbanBoard
            key={refreshKey}
            filterPriority={filterPriority}
          />
        ) : (
          <ListView />
        )}
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
