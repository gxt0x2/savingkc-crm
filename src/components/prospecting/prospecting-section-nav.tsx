import Link from 'next/link'

export function ProspectingSectionNav({ current }: { current: 'campaigns' | 'reports' }) {
  const linkClass = (active: boolean) => active
    ? 'font-black text-[var(--crm-ink)]'
    : 'font-bold text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]'

  return (
    <nav aria-label="Prospecting sections" className="flex items-center gap-2 text-sm">
      <Link href="/prospecting" aria-current={current === 'campaigns' ? 'page' : undefined} className={linkClass(current === 'campaigns')}>Campaigns</Link>
      <span aria-hidden="true" className="text-[var(--crm-text-dim)]">|</span>
      <Link href="/prospecting/reports" aria-current={current === 'reports' ? 'page' : undefined} className={linkClass(current === 'reports')}>Call Reports</Link>
    </nav>
  )
}
