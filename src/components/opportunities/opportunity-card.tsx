'use client'

import { Icon } from '@/components/ui/icon'
import { PersonalityBadge } from '@/components/ui/personality-badge'
import { AriInsight } from '@/components/ari/ari-insight'
import type { Deal } from '@/types'
import Link from 'next/link'

function dollars(amount: number | null): string {
  if (amount == null) return '--'
  return '$' + amount.toLocaleString('en-US')
}

export function OpportunityCard({ deal }: { deal: Deal }) {
  const contact = deal.contact
  if (!contact) return null

  const fullName = `${contact.first_name} ${contact.last_name}`
  const address = deal.property_address || [contact.address, contact.city].filter(Boolean).join(', ')

  return (
    <div className="bg-surface-container-lowest rounded-xl p-6 shadow-md border border-outline-variant/20 flex flex-col gap-6 hover:shadow-lg transition-shadow">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-bold text-primary">{fullName}</h3>
            <PersonalityBadge type={contact.personality_type} />
          </div>
          <p className="text-xs text-on-surface-variant flex items-center gap-1">
            <Icon name="location_on" size="text-xs" />
            {address}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Next Step</div>
          <div className="text-sm font-bold text-primary">
            {new Date(deal.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {/* Ari Insight */}
      <AriInsight insight={deal.ari_insight} tags={deal.ari_tags} />

      {/* Deal Math */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">Deal at a Glance</span>
          <div className="h-[1px] flex-grow mx-4 bg-surface-container-high" />
        </div>
        <div className="grid grid-cols-2 gap-y-4 gap-x-8">
          <div>
            <div className="text-[10px] uppercase font-bold text-on-surface-variant mb-1">ARV</div>
            <div className="text-lg font-bold text-primary">{dollars(deal.arv)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-on-surface-variant mb-1">As-Is Market</div>
            <div className="text-lg font-bold text-primary">{dollars(deal.as_is_value)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-on-surface-variant mb-1">Asking</div>
            <div className="text-lg font-bold text-on-tertiary-container">{dollars(deal.asking_price)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold text-on-surface-variant mb-1">Equity</div>
            <div className="text-lg font-bold text-secondary">{dollars(deal.equity)}</div>
          </div>
          <div className="col-span-2 p-3 bg-surface-container-high rounded-lg flex justify-between items-center">
            <div>
              <div className="text-[10px] uppercase font-bold text-on-surface-variant">Debt Total</div>
              <div className="text-sm font-medium text-primary">{dollars(deal.debt_total)}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase font-bold text-secondary">Est. Assignment</div>
              <div className="text-xl font-black text-secondary">{dollars(deal.est_assignment)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-surface-container-high">
        <div className="text-[10px] text-on-surface-variant uppercase font-medium">
          Last Contact: {new Date(deal.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </div>
        <Link
          href={`/leads/${contact.id}`}
          className="flex items-center gap-2 text-sm font-bold text-primary hover:text-secondary transition-colors"
        >
          <span>Details</span>
          <Icon name="arrow_forward" size="text-sm" />
        </Link>
      </div>
    </div>
  )
}
