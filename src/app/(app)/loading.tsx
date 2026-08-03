export default function WorkspaceRouteLoading() {
  return (
    <main aria-label="Loading workspace" className="min-h-full bg-[var(--crm-canvas)] p-5 sm:p-6">
      <span className="sr-only">Loading the selected workspace</span>
      <div className="animate-pulse space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="h-3 w-28 rounded-full bg-[var(--crm-brand-soft)]" />
            <div className="h-7 w-56 rounded-lg bg-[var(--crm-surface-subtle)]" />
          </div>
          <div className="h-10 w-32 rounded-lg bg-[var(--crm-surface-subtle)]" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="crm-panel h-36 rounded-2xl bg-[var(--crm-surface)]" />
          <div className="crm-panel h-36 rounded-2xl bg-[var(--crm-surface)]" />
          <div className="crm-panel h-36 rounded-2xl bg-[var(--crm-surface)]" />
        </div>
        <div className="crm-panel h-[min(32rem,55vh)] rounded-2xl bg-[var(--crm-surface)]" />
      </div>
    </main>
  )
}
