'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface ActivityRow {
  id: string
  contactName: string
  initials: string
  nextStep: string
  nextStepUrgent?: boolean
  streetAddress: string
  lastActivity: string
  avatarBg: string
}

const mockActivities: ActivityRow[] = [
  {
    id: '1',
    contactName: 'Tom Higgins',
    initials: 'TH',
    nextStep: 'Today 4:00 PM',
    streetAddress: '219 NW 4th Ter, Blue Springs',
    lastActivity: 'Outbound Call (3m)',
    avatarBg: 'bg-primary-fixed text-on-primary-fixed',
  },
  {
    id: '2',
    contactName: 'Elena Wright',
    initials: 'EW',
    nextStep: 'Mar 25, 9:00 AM',
    streetAddress: '7401 Walrond Ave, Kansas City',
    lastActivity: 'Inbound SMS',
    avatarBg: 'bg-tertiary-fixed text-on-tertiary-fixed',
  },
  {
    id: '3',
    contactName: 'Bill Stephens',
    initials: 'BS',
    nextStep: 'Today 2:15 PM',
    nextStepUrgent: true,
    streetAddress: '112 S Water St, Liberty',
    lastActivity: 'Missed Call',
    avatarBg: 'bg-secondary-fixed text-on-secondary-fixed',
  },
]

export function ActivityTable() {
  const [view, setView] = useState<'list' | 'grid'>('list')

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-primary">All Activity</h2>
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

      <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-outline-variant/10">
        <table className="w-full text-left border-collapse">
          <thead className="bg-surface-container-low text-[10px] uppercase font-bold tracking-widest text-on-surface-variant">
            <tr>
              <th className="px-6 py-4 border-b border-surface-container-high">
                <div className="flex items-center gap-2">
                  <Icon name="drag_indicator" size="text-[14px]" className="cursor-grab active:cursor-grabbing" />
                  Contact Name
                </div>
              </th>
              <th className="px-6 py-4 border-b border-surface-container-high">
                <div className="flex items-center gap-2">
                  <Icon name="drag_indicator" size="text-[14px]" className="cursor-grab active:cursor-grabbing" />
                  Next Step
                </div>
              </th>
              <th className="px-6 py-4 border-b border-surface-container-high">
                <div className="flex items-center gap-2">
                  <Icon name="drag_indicator" size="text-[14px]" className="cursor-grab active:cursor-grabbing" />
                  Street Address
                </div>
              </th>
              <th className="px-6 py-4 border-b border-surface-container-high">
                <div className="flex items-center gap-2">
                  <Icon name="drag_indicator" size="text-[14px]" className="cursor-grab active:cursor-grabbing" />
                  Last Activity
                </div>
              </th>
              <th className="px-6 py-4 border-b border-surface-container-high" />
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container-high">
            {mockActivities.map((row) => (
              <tr key={row.id} className="hover:bg-surface-container-low transition-colors group">
                <td className="px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold ${row.avatarBg}`}>
                      {row.initials}
                    </div>
                    <span className="text-sm font-semibold text-primary">{row.contactName}</span>
                  </div>
                </td>
                <td className="px-6 py-5">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      row.nextStepUrgent
                        ? 'bg-error-container text-error'
                        : 'bg-secondary-container/30 text-secondary'
                    }`}
                  >
                    {row.nextStep}
                  </span>
                </td>
                <td className="px-6 py-5 text-sm text-on-surface-variant">{row.streetAddress}</td>
                <td className="px-6 py-5 text-sm text-on-surface-variant">{row.lastActivity}</td>
                <td className="px-6 py-5 text-right">
                  <button className="text-on-surface-variant hover:text-primary transition-colors">
                    <Icon name="more_vert" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
