import { Icon } from '@/components/ui/icon'
import type { CrmEntityContext } from '@/lib/server/crm-entity-foundation'

export function EntityIdentityStatus({ context }: { context?: CrmEntityContext | null }) {
  if (!context?.available) return null

  const phone = context.contactMethods.find((method) => method.type === 'phone' && method.isPrimary)
  const needsReview = context.openIdentityConflicts > 0
  const linked = context.linked && !context.degraded

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" aria-label="Canonical CRM identity status">
      <span
        className={needsReview
          ? 'inline-flex items-center gap-1 rounded-md bg-[var(--crm-danger-soft)] px-2 py-1 text-[10px] font-bold text-[var(--crm-danger)]'
          : linked
            ? 'inline-flex items-center gap-1 rounded-md bg-[var(--crm-success-soft)] px-2 py-1 text-[10px] font-bold text-[var(--crm-success)]'
            : 'inline-flex items-center gap-1 rounded-md bg-[var(--crm-warning-soft)] px-2 py-1 text-[10px] font-bold text-[var(--crm-warning)]'}
        title={needsReview ? `${context.openIdentityConflicts} identity conflict${context.openIdentityConflicts === 1 ? '' : 's'} require review.` : linked ? 'Person, property, and opportunity are linked.' : 'The canonical record projection is incomplete.'}
      >
        <Icon name={needsReview ? 'warning' : linked ? 'verified' : 'sync'} className="text-[13px]" />
        {needsReview ? 'Identity review' : linked ? 'Identity linked' : 'Record syncing'}
      </span>
      {phone?.smsConsentStatus === 'opted_out' ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-[var(--crm-danger-soft)] px-2 py-1 text-[10px] font-bold text-[var(--crm-danger)]" title="SMS consent is opted out in the canonical contact record.">
          <Icon name="sms_failed" className="text-[13px]" />
          SMS opted out
        </span>
      ) : null}
    </span>
  )
}
