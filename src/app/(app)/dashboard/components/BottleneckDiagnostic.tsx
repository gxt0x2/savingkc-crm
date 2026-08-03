const stages = [
  {
    title: 'Lead',
    score: '50',
    drivers: ['Pain stated', 'Property fit', 'Motivation clear'],
  },
  {
    title: 'Opportunity',
    score: '90',
    drivers: ['Appointment set', 'Seller responsive', 'Timeline confirmed'],
  },
  {
    title: 'Appointment',
    score: '20',
    drivers: ['Offer path clear', 'Decision maker present', 'Repair risk known'],
  },
  {
    title: 'Deal',
    score: '80',
    drivers: ['Contract signed', 'Assignment path', 'Closing readiness'],
  },
]

export function BottleneckDiagnostic() {
  return (
    <section className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4 text-[var(--crm-ink)]">
      <div className="mb-4 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--crm-text-dim)]">Diagnostic Funnel</div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_56px_1fr_56px_1fr_56px_1fr]">
        {stages.map((stage, index) => (
          <FragmentStage key={stage.title} stage={stage} index={index} />
        ))}
      </div>
    </section>
  )
}

function FragmentStage({ stage, index }: { stage: (typeof stages)[number]; index: number }) {
  return (
    <>
      <div data-testid="diagnostic-stage" className="rounded-md border border-[var(--crm-border)] bg-[var(--crm-surface)] p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-black">{stage.title}</h3>
          <span className="text-xl font-black tabular-nums text-[var(--crm-ink)]">{stage.score}</span>
        </div>
        <ul className="mt-3 space-y-1 text-xs text-[var(--crm-text-muted)]">
          {stage.drivers.map((driver) => (
            <li key={driver}>{driver}</li>
          ))}
        </ul>
      </div>
      {index < stages.length - 1 && (
        <div data-testid="diagnostic-transition" className="flex items-center justify-center text-xs font-black text-[var(--crm-text-dim)]">
          {index === 0 ? '50%' : index === 1 ? '90%' : '20%'}
        </div>
      )}
    </>
  )
}
