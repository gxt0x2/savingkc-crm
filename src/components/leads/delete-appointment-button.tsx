'use client'

import { useId, useState } from 'react'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'

export function DeleteAppointmentButton({
  leadId,
  appointmentId,
  scheduledAt,
  onDeleted,
  className,
}: {
  leadId: string
  appointmentId?: string | null
  scheduledAt?: string | null
  onDeleted: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const titleId = useId()
  const dialogRef = useDialogAccessibility<HTMLDivElement>(open, () => {
    if (!deleting) finish(Boolean(warning))
  })

  function finish(deleted: boolean) {
    if (deleting) return
    setOpen(false)
    setError(null)
    setWarning(null)
    if (deleted) onDeleted()
  }

  async function confirmDelete() {
    setDeleting(true)
    setError(null)
    try {
      const response = await fetch('/api/leads/delete-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          ...(appointmentId ? { appointmentId } : {}),
          ...(scheduledAt ? { scheduledAt } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string; warning?: string }
      if (!response.ok) throw new Error(payload.error || 'Appointment could not be deleted')
      if (payload.warning) {
        setWarning(payload.warning)
        return
      }
      setOpen(false)
      onDeleted()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Appointment could not be deleted')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null)
          setWarning(null)
          setOpen(true)
        }}
        className={className}
      >
        Delete appointment
      </button>
      {open ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="w-full max-w-sm rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] p-6 shadow-xl"
          >
            <h2 id={titleId} className="text-lg font-bold text-[var(--crm-ink)]">Delete appointment</h2>
            <p className="mt-2 text-sm text-[var(--crm-text)]">Delete this appointment? This cannot be undone.</p>
            {error ? <p role="alert" className="mt-3 text-sm font-semibold text-[var(--crm-danger)]">{error}</p> : null}
            {warning ? <p role="status" className="mt-3 text-sm font-semibold text-[var(--crm-danger)]">{warning}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => finish(Boolean(warning))} className="rounded-lg px-4 py-2 text-sm font-bold text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-subtle)]">
                {warning ? 'Close' : 'Cancel'}
              </button>
              {warning ? null : (
                <button
                  type="button"
                  onClick={() => void confirmDelete()}
                  disabled={deleting}
                  className="rounded-lg bg-[var(--crm-danger)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
