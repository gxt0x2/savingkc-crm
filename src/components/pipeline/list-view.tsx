'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn, stageLabel } from '@/lib/utils'
import type { PersonalityType, DealStage } from '@/types'

interface ListDeal {
  id: string
  initials: string
  name: string
  address: string
  smartTags: string[]
  leadScore: number
  leadOwner: string
  currentStage: DealStage
  nextStep: string
  nextStepDate: string
  lastActivity: string
  personalityType: PersonalityType | null
  avatarBg: string
}

const tagColors: Record<string, string> = {
  'High Intent': 'bg-secondary-container/30 text-secondary',
  'Cash Buyer': 'bg-surface-container-high text-on-surface-variant',
  'Distressed': 'bg-tertiary-container/10 text-on-tertiary-container',
  'Follow Up': 'bg-primary-fixed text-on-primary-fixed-variant',
  'Pre-Foreclosure': 'bg-surface-container-high text-on-surface-variant',
  'Motivated': 'bg-secondary-container/30 text-secondary',
  'Vacant': 'bg-surface-container-high text-on-surface-variant',
  'Probate': 'bg-tertiary-container/10 text-on-tertiary-container',
}

function scoreColor(score: number): string {
  if (score >= 80) return 'border-secondary text-secondary'
  if (score >= 50) return 'border-secondary/50 text-secondary'
  if (score >= 40) return 'border-on-tertiary-container text-on-tertiary-container'
  return 'border-outline-variant text-on-surface-variant'
}

const mockDeals: ListDeal[] = [
  {
    id: 'l1',
    initials: 'JD',
    name: 'Jonathan Doe',
    address: '123 Highland Ave, Austin, TX',
    smartTags: ['High Intent', 'Cash Buyer'],
    leadScore: 92,
    leadOwner: 'Marcus V.',
    currentStage: 'contract_signed',
    nextStep: 'Inspection Review',
    nextStepDate: 'Oct 14, 2:00 PM',
    lastActivity: '2 hours ago',
    personalityType: 'assertive',
    avatarBg: 'bg-primary-fixed text-on-primary-fixed',
  },
  {
    id: 'l2',
    initials: 'SM',
    name: 'Sarah Miller',
    address: '4502 Oak Lane, Dallas, TX',
    smartTags: ['Distressed'],
    leadScore: 45,
    leadOwner: 'Elena R.',
    currentStage: 'qualifying',
    nextStep: 'ARV Calculation',
    nextStepDate: 'Oct 14, 4:30 PM',
    lastActivity: '1 day ago',
    personalityType: 'analytical',
    avatarBg: 'bg-tertiary-fixed text-on-tertiary-fixed',
  },
  {
    id: 'l3',
    initials: 'BW',
    name: 'Bill Watson',
    address: '889 Pearl St, Boulder, CO',
    smartTags: ['Follow Up'],
    leadScore: 78,
    leadOwner: 'Marcus V.',
    currentStage: 'negotiations',
    nextStep: 'Send Counter Offer',
    nextStepDate: 'Oct 15, 9:00 AM',
    lastActivity: '4 hours ago',
    personalityType: 'expressive',
    avatarBg: 'bg-secondary-fixed text-on-secondary-fixed',
  },
  {
    id: 'l4',
    initials: 'KP',
    name: 'Kevin Parker',
    address: '211 River Dr, Tampa, FL',
    smartTags: ['Pre-Foreclosure'],
    leadScore: 32,
    leadOwner: 'David S.',
    currentStage: 'new',
    nextStep: 'First Call Attempt',
    nextStepDate: 'Oct 16, 11:15 AM',
    lastActivity: '12 mins ago',
    personalityType: 'amiable',
    avatarBg: 'bg-surface-dim text-on-surface',
  },
  {
    id: 'l5',
    initials: 'MT',
    name: 'Michael Thompson',
    address: '1234 Oak St, Kansas City, MO',
    smartTags: ['Motivated', 'Vacant'],
    leadScore: 85,
    leadOwner: 'Marcus V.',
    currentStage: 'contacted',
    nextStep: 'Follow Up Call',
    nextStepDate: 'Oct 14, 2:00 PM',
    lastActivity: '2h ago',
    personalityType: 'assertive',
    avatarBg: 'bg-primary-fixed text-on-primary-fixed',
  },
  {
    id: 'l6',
    initials: 'SC',
    name: 'Sarah Chen',
    address: '5678 Maple Ave, OP, KS',
    smartTags: ['High Intent'],
    leadScore: 71,
    leadOwner: 'Elena R.',
    currentStage: 'contacted',
    nextStep: 'Property Walkthrough',
    nextStepDate: 'Oct 15, 10:00 AM',
    lastActivity: '5h ago',
    personalityType: 'analytical',
    avatarBg: 'bg-secondary-fixed text-on-secondary-fixed',
  },
  {
    id: 'l7',
    initials: 'AM',
    name: 'Alisha Miller',
    address: '2921 Prospect Ave, KC',
    smartTags: ['Motivated'],
    leadScore: 88,
    leadOwner: 'Marcus V.',
    currentStage: 'qualifying',
    nextStep: 'PRD Review',
    nextStepDate: 'Oct 16, 1:00 PM',
    lastActivity: '1h ago',
    personalityType: 'expressive',
    avatarBg: 'bg-primary-fixed text-on-primary-fixed',
  },
  {
    id: 'l8',
    initials: 'DH',
    name: 'David Harris',
    address: '402 W 14th St, KC',
    smartTags: ['Cash Buyer', 'High Intent'],
    leadScore: 94,
    leadOwner: 'David S.',
    currentStage: 'negotiations',
    nextStep: 'Final Offer',
    nextStepDate: 'Oct 14, 5:00 PM',
    lastActivity: '30 mins ago',
    personalityType: 'assertive',
    avatarBg: 'bg-surface-variant text-on-surface',
  },
  {
    id: 'l9',
    initials: 'LC',
    name: 'Linda Carter',
    address: '2102 Jackson Ave',
    smartTags: ['Probate'],
    leadScore: 67,
    leadOwner: 'Elena R.',
    currentStage: 'contract_signed',
    nextStep: 'Title Search',
    nextStepDate: 'Oct 17, 9:00 AM',
    lastActivity: '3h ago',
    personalityType: 'amiable',
    avatarBg: 'bg-secondary-container text-on-secondary-container',
  },
  {
    id: 'l10',
    initials: 'JW',
    name: 'James Wilson',
    address: "9101 Pine Terrace, Lee's Summit",
    smartTags: ['Follow Up'],
    leadScore: 73,
    leadOwner: 'Marcus V.',
    currentStage: 'appt_set',
    nextStep: 'Inspection Call',
    nextStepDate: 'Oct 14, 4:30 PM',
    lastActivity: '6h ago',
    personalityType: 'amiable',
    avatarBg: 'bg-tertiary-fixed text-on-tertiary-fixed',
  },
]

const PAGE_SIZE = 10

export function ListView() {
  const [page, setPage] = useState(0)
  const totalItems = 124
  const start = page * PAGE_SIZE
  const displayed = mockDeals.slice(0, PAGE_SIZE)

  return (
    <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-[0px_8px_24px_rgba(25,28,29,0.04)]">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low border-b border-outline-variant/10">
              {['Contact Name', 'Street Address', 'Smart Tags', 'Lead Score', 'Lead Owner', 'Current Stage', 'Next Step', 'Last Activity'].map(
                (header) => (
                  <th
                    key={header}
                    className="px-6 py-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-wider whitespace-nowrap"
                  >
                    <div className="flex items-center gap-2">
                      {header}
                      <Icon name="drag_indicator" size="text-base" className="cursor-move text-outline" />
                    </div>
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/10">
            {displayed.map((deal, i) => (
              <tr
                key={deal.id}
                className={cn(
                  'hover:bg-surface-container-low transition-colors',
                  i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low/30'
                )}
              >
                {/* Contact Name */}
                <td className="px-6 py-5 whitespace-nowrap">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs',
                        deal.avatarBg
                      )}
                    >
                      {deal.initials}
                    </div>
                    <span className="text-sm font-semibold text-primary">{deal.name}</span>
                  </div>
                </td>

                {/* Street Address */}
                <td className="px-6 py-5 whitespace-nowrap">
                  <span className="text-sm text-on-surface-variant">{deal.address}</span>
                </td>

                {/* Smart Tags */}
                <td className="px-6 py-5 whitespace-nowrap">
                  <div className="flex gap-2">
                    {deal.smartTags.map((tag) => (
                      <span
                        key={tag}
                        className={cn(
                          'px-2 py-0.5 rounded text-[10px] font-bold uppercase',
                          tagColors[tag] || 'bg-surface-container-high text-on-surface-variant'
                        )}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>

                {/* Lead Score */}
                <td className="px-6 py-5 whitespace-nowrap">
                  <div className={cn('w-10 h-10 rounded-full border-2 flex items-center justify-center', scoreColor(deal.leadScore))}>
                    <span className="text-xs font-extrabold">{deal.leadScore}</span>
                  </div>
                </td>

                {/* Lead Owner */}
                <td className="px-6 py-5 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-surface-container-high flex items-center justify-center text-[10px] font-bold text-on-surface-variant">
                      {deal.leadOwner.split(' ').map(w => w[0]).join('')}
                    </div>
                    <span className="text-xs font-medium text-on-surface">{deal.leadOwner}</span>
                  </div>
                </td>

                {/* Current Stage */}
                <td className="px-6 py-5 whitespace-nowrap">
                  <span className="text-sm font-medium text-primary">{stageLabel(deal.currentStage)}</span>
                </td>

                {/* Next Step */}
                <td className="px-6 py-5 whitespace-nowrap">
                  <div className="text-xs text-on-surface font-semibold">{deal.nextStep}</div>
                  <div className="text-[10px] text-on-surface-variant">{deal.nextStepDate}</div>
                </td>

                {/* Last Activity */}
                <td className="px-6 py-5 whitespace-nowrap">
                  <span className="text-xs text-on-surface-variant font-medium">{deal.lastActivity}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-6 py-4 bg-surface-container-low/50 flex items-center justify-between">
        <span className="text-xs font-medium text-on-surface-variant">
          Showing {start + 1}-{Math.min(start + PAGE_SIZE, totalItems)} of {totalItems} leads
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant disabled:opacity-30"
          >
            <Icon name="chevron_left" />
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={start + PAGE_SIZE >= totalItems}
            className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant disabled:opacity-30"
          >
            <Icon name="chevron_right" />
          </button>
        </div>
      </div>
    </div>
  )
}
