'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import type { Deal } from '@/types'

interface ActivityTableProps {
  deals: Deal[]
  onPinToHot?: (dealId: string) => void
  hotCount?: number
}

const STAGE_LABELS: Record<string, string> = {
  contacted: 'Leads',
  qualifying: 'Qualifying',
  qualified: 'Opportunities',
  appt_set: 'Appt Set',
  negotiations: 'Negotiations',
  offer_made: 'Offer Made',
  contract_signed: 'Contract',
}

function getInitials(name: string): string {
  const parts = name.split(' ')
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function getAvatarBg(index: number): string {
  const colors = [
    'bg-primary-fixed text-on-primary-fixed',
    'bg-secondary-fixed text-on-secondary-fixed',
    'bg-tertiary-fixed text-on-tertiary-fixed',
  ]
  return colors[index % colors.length]
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dollars(amount: number | null): string {
  if (amount == null) return '--'
  return '$' + amount.toLocaleString('en-US')
}

export function ActivityTable({ deals, onPinToHot, hotCount = 0 }: ActivityTableProps) {
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [showAll, setShowAll] = useState(false)

  const displayDeals = showAll ? deals : deals.slice(0, 20)

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-primary">All Opportunities</h2>
          <span className="text-sm text-on-surface-variant">
            Showing {displayDeals.length} of {deals.length}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex bg-surface-container rounded-lg p-1">
            <button
              onClick={() => setView('list')}
              className={`p-2 rounded-md transition-colors ${view === 'list' ? 'bg-white shadow-sm text-primary' : 'text-on-surface-variant'}`}
            >
              <Icon name="list" size="text-sm" />
            </button>
            <button
              onClick={() => setView('grid')}
              className={`p-2 rounded-md transition-colors ${view === 'grid' ? 'bg-white shadow-sm text-primary' : 'text-on-surface-variant'}`}
            >
              <Icon name="grid_view" size="text-sm" />
            </button>
          </div>
          <button className="flex items-center gap-2 text-sm font-medium text-on-surface-variant hover:text-primary transition-colors">
            <Icon name="filter_list" size="text-sm" />
            <span>Filter</span>
          </button>
        </div>
      </div>

      {deals.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center border border-outline-variant/10">
          <Icon name="work" className="text-4xl text-slate-300 mb-3" />
          <p className="text-slate-400 font-medium">No opportunities yet</p>
          <p className="text-slate-400 text-sm mt-1">Leads in active pipeline stages will appear here.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-outline-variant/10">
            <table className="w-full text-left border-collapse">
              <thead className="bg-surface-container-low text-[10px] uppercase font-bold tracking-widest text-on-surface-variant">
                <tr>
                  <th className="px-6 py-4 border-b border-surface-container-high">Contact Name</th>
                  <th className="px-6 py-4 border-b border-surface-container-high">Property Address</th>
                  <th className="px-6 py-4 border-b border-surface-container-high">Stage</th>
                  <th className="px-6 py-4 border-b border-surface-container-high">Est. Assignment</th>
                  <th className="px-6 py-4 border-b border-surface-container-high">Score</th>
                  <th className="px-6 py-4 border-b border-surface-container-high">Last Activity</th>
                  <th className="px-6 py-4 border-b border-surface-container-high" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-high">
                {displayDeals.map((deal, idx) => {
                  const contactName = deal.contact
                    ? `${deal.contact.first_name} ${deal.contact.last_name}`
                    : 'Unknown'
                  const initials = getInitials(contactName)

                  return (
                    <tr key={deal.id} className="hover:bg-surface-container-low transition-colors group">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ${getAvatarBg(idx)}`}>
                            {initials}
                          </div>
                          <span className="text-sm font-semibold text-primary">{contactName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-sm text-on-surface-variant">{deal.property_address || '--'}</td>
                      <td className="px-6 py-5">
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-secondary-container/30 text-secondary">
                          {STAGE_LABELS[deal.stage] || deal.stage}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-sm font-medium text-primary">{dollars(deal.est_assignment)}</td>
                      <td className="px-6 py-5">
                        <div className="text-sm font-bold text-primary">
                          {deal._qualificationScore ?? '--'}
                        </div>
                      </td>
                      <td className="px-6 py-5 text-sm text-on-surface-variant">{formatRelativeTime(deal.updated_at)}</td>
                      <td className="px-6 py-5 text-right">
                        <div className="relative">
                          {onPinToHot && (
                            <button
                              onClick={() => {
                                if (hotCount >= 4) {
                                  alert('Hot Opportunities is full (4/4). Unpin an existing deal first.')
                                } else {
                                  onPinToHot(deal.id)
                                }
                              }}
                              className="text-on-surface-variant hover:text-primary transition-colors"
                              title="Pin to Hot"
                            >
                              <Icon name="push_pin" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {deals.length > 20 && !showAll && (
            <div className="mt-4 text-center">
              <button
                onClick={() => setShowAll(true)}
                className="px-6 py-2 bg-surface-container hover:bg-surface-container-high text-primary font-medium rounded-lg transition-colors"
              >
                Show More ({deals.length - 20} more)
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
