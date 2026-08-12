'use client'

import type { ReactNode } from 'react'
import { Icon } from '@/components/ui/icon'

type PipelineFilterSelectProps = {
  label: string
  value: string
  onChange: (value: string) => void
  options: [string, string][]
}

export function PipelineFilterSelect({ label, value, onChange, options }: PipelineFilterSelectProps) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`h-9 w-full rounded-lg border px-3 text-xs font-semibold ${value ? 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'crm-field'}`}
    >
      <option value="">{label}</option>
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue}>{optionLabel}</option>
      ))}
    </select>
  )
}

export function PipelineModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#111827]/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="crm-modal-surface max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--ck-border)] px-6 py-4">
          <h2 className="text-lg font-bold text-[var(--ck-text)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-[var(--ck-text-muted)] hover:text-[var(--ck-accent)]"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="p-6">{children}</div>
      </section>
    </div>
  )
}

export function PipelineModalActions({ saving, submitLabel, onCancel }: { saving: boolean; submitLabel: string; onCancel: () => void }) {
  return (
    <div className="flex gap-3 pt-2">
      <button
        type="button"
        disabled={saving}
        onClick={onCancel}
        className="h-10 flex-1 rounded-lg border border-[var(--ck-border-strong)] text-sm font-bold"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={saving}
        className="h-10 flex-1 rounded-lg bg-[var(--ck-accent)] text-sm font-bold text-white disabled:opacity-50"
      >
        {saving ? 'Saving…' : submitLabel}
      </button>
    </div>
  )
}
