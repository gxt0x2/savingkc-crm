'use client'

import { useEffect, useState } from 'react'

const OWNERS = ['Ernest', 'Casey', 'Gertha'] as const

export function ContactOwnerAssignment({ leadId, owner, actorName, onChanged }: {
  leadId: string
  owner: string | null
  actorName: string
  onChanged?: () => void | Promise<void>
}) {
  const [draft, setDraft] = useState(owner ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setDraft(owner ?? '')
    setMessage(null)
  }, [leadId, owner])

  async function assign(nextOwner: string) {
    if (saving) return
    const previous = draft
    setDraft(nextOwner)
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/leads/${leadId}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assign',
          owner: nextOwner || null,
          reason: `Direct assignment by ${actorName}`,
        }),
      })
      const payload = await response.json().catch(() => ({})) as { success?: boolean; error?: string }
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Owner could not be updated')
      setMessage(nextOwner ? `Assigned to ${nextOwner}.` : 'Contact is now unassigned.')
      await onChanged?.()
    } catch (error) {
      setDraft(previous)
      setMessage(error instanceof Error ? error.message : 'Owner could not be updated')
    } finally {
      setSaving(false)
    }
  }

  return <label className="mt-4 block">
    <span className="mb-1.5 block text-xs font-bold text-[var(--crm-text-muted)]">Owner</span>
    <select
      aria-label="Assign contact owner"
      value={draft}
      disabled={saving}
      onChange={(event) => void assign(event.target.value)}
      className="crm-field h-10 w-full rounded-lg px-3 text-sm font-semibold disabled:cursor-wait disabled:opacity-60"
    >
      <option value="">Unassigned</option>
      {OWNERS.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
    {message ? <span className="mt-2 block text-xs font-semibold text-[var(--crm-text-muted)]" role="status">{message}</span> : null}
  </label>
}
