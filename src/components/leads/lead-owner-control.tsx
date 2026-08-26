'use client'

import { useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

const OWNER_OPTIONS = ['', 'Ernest', 'Casey', 'Gertha'] as const

interface LeadOwnerControlProps {
  leadId: string
  owner: string | null
  onChanged: (owner: string | null) => void
  variant?: 'badge' | 'panel'
}

export function LeadOwnerControl({ leadId, owner, onChanged, variant = 'badge' }: LeadOwnerControlProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedOwner = owner ?? ''

  async function assignOwner(nextOwner: string) {
    if (saving || nextOwner === selectedOwner) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/leads/${leadId}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assign', owner: nextOwner || null }),
      })
      const payload = await response.json().catch(() => ({})) as {
        success?: boolean
        error?: string
        result?: { owner?: string | null }
      }
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Owner could not be saved')
      onChanged(payload.result?.owner ?? (nextOwner || null))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Owner could not be saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cn('min-w-0', variant === 'panel' && 'w-full')}>
      <label className={cn(
        'flex items-center gap-1.5 font-semibold text-[var(--crm-text-muted)]',
        variant === 'panel' ? 'w-full' : 'text-[11px]',
      )}>
        <span className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-[var(--crm-charcoal)] font-bold text-[var(--crm-surface)]',
          variant === 'panel' ? 'h-7 w-7 text-[10px]' : 'h-5 w-5 text-[8px]',
        )}>{selectedOwner ? selectedOwner.slice(0, 2).toUpperCase() : 'UN'}</span>
        <span className="sr-only">Assigned person</span>
        <select
          aria-label="Assigned person"
          value={selectedOwner}
          disabled={saving}
          onChange={(event) => void assignOwner(event.target.value)}
          className={cn(
            'min-w-0 cursor-pointer rounded-md border border-transparent bg-transparent font-semibold text-[var(--crm-text)] outline-none hover:border-[var(--crm-border-strong)] focus:border-[var(--crm-info)] disabled:cursor-wait disabled:opacity-60',
            variant === 'panel' ? 'h-9 flex-1 px-2 text-sm' : 'h-7 max-w-28 px-1 text-[11px]',
          )}
        >
          {OWNER_OPTIONS.map((value) => <option key={value || 'unassigned'} value={value}>{value || 'Unassigned'}</option>)}
        </select>
        {saving ? <Icon name="progress_activity" className="animate-spin text-[15px]" /> : null}
      </label>
      {error ? <p role="alert" className="mt-1 text-[11px] font-semibold text-[var(--crm-danger)]">{error}</p> : null}
    </div>
  )
}
