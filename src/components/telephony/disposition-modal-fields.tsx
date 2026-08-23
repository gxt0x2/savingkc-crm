import { Icon } from '@/components/ui/icon'

export function ConnectionPill({ status }: { status: string }) {
  if (status === 'connected') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#30D1582E] text-[#30D158] text-[11px] font-medium"><Icon name="call" size="text-[11px]" filled />Connected</span>
  }
  if (status === 'voicemail') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#64D2FF2E] text-[#64D2FF] text-[11px] font-medium"><Icon name="voicemail" size="text-[11px]" />Voicemail</span>
  }
  if (status === 'no_answer') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#98989E38] text-[var(--skc-text-secondary)] text-[11px] font-medium"><Icon name="phone_missed" size="text-[11px]" />No Answer</span>
  }
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#98989E38] text-[var(--skc-text-secondary)] text-[11px] font-medium capitalize">{status.replace(/_/g, ' ')}</span>
}

export function AppointmentDateTimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="px-4 pt-4">
      <label className="block rounded-[var(--skc-radius-card)] border border-[var(--skc-brand-soft-border)] bg-[var(--skc-brand-soft)] p-3">
        <span className="flex items-center justify-between pb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--skc-text-secondary)]">Appointment date and time<span className="text-[#FF453A]">Required</span></span>
        <input type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-[var(--skc-radius-control)] border border-[var(--skc-separator)] bg-[var(--skc-surface-2)] px-3 py-2.5 text-[15px] text-white outline-none focus:border-[var(--skc-brand)]" />
        <span className="mt-2 block text-[12px] text-[var(--skc-text-tertiary)]">The CRM will save this exact time. It will not invent a placeholder appointment.</span>
      </label>
    </div>
  )
}
