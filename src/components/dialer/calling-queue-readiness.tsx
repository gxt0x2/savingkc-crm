export function CallingQueueReadiness({ people, ready, verified }: { people: number; ready: number; verified: number }) {
  const stats = [
    { label: 'People found', value: people, className: 'text-[var(--ck-text)]', container: 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)]' },
    { label: 'Ready numbers', value: ready, className: 'text-[#E32E2E]', container: 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)]' },
    { label: 'Verified', value: verified, className: 'text-emerald-500', container: 'border-emerald-500/20 bg-emerald-500/10' },
  ]

  return (
    <div className="mb-5 grid grid-cols-3 gap-2" aria-label="Calling queue readiness">
      {stats.map((stat) => (
        <div key={stat.label} className={`rounded-xl border px-3 py-3 ${stat.container}`}>
          <p className={`text-xl font-black tabular-nums ${stat.className}`}>{stat.value}</p>
          <p className="mt-1 text-[9px] font-black uppercase tracking-[0.14em] text-[var(--ck-text-dim)]">{stat.label}</p>
        </div>
      ))}
    </div>
  )
}
