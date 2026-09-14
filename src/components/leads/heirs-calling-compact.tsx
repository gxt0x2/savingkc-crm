'use client'

import { Icon } from '@/components/ui/icon'
import { formatPhone, toProperCase } from '@/lib/format'
import {
  isAutoCallablePhone,
  verifiedPhoneOf,
  type Heir,
  type HeirPhone,
} from '@/lib/heir-dialer-queue'

type HeirsCallingCompactProps = {
  callablePhonesForHeir: (heir: Heir) => HeirPhone[]
  error: string | null
  heirs: Heir[]
  loading: boolean
  queueOne: (heir: Heir, phone: HeirPhone) => void
  readOnlyPreview: boolean
}

export function HeirsCallingCompact({
  callablePhonesForHeir,
  error,
  heirs,
  loading,
  queueOne,
  readOnlyPreview,
}: HeirsCallingCompactProps) {
  return <section aria-label="Callable people" className="border-b border-[var(--ck-border)] pb-4">
    {error ? <p role="alert" className="mb-3 rounded-lg border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-medium text-[var(--crm-danger)]">{error}</p> : null}
    {loading ? <div role="status" className="grid min-h-28 place-items-center"><Icon name="progress_activity" className="animate-spin text-xl text-[var(--ck-text-dim)]" /></div> : null}
    {!loading && heirs.length === 0 ? <p className="rounded-xl border border-[var(--ck-border)] bg-[var(--prospecting-elevated)] px-3 py-4 text-xs text-[var(--ck-text-muted)]">No callable people are attached to this record.</p> : null}
    {!loading && heirs.length > 0 ? <div className={`grid grid-cols-1 gap-2 ${heirs.length > 1 ? 'sm:grid-cols-2' : ''}`}>
      {heirs.map((heir) => {
        const verifiedPhone = verifiedPhoneOf(heir)
        const phone = verifiedPhone ?? callablePhonesForHeir(heir)[0] ?? heir.phones[0] ?? null
        const displayName = toProperCase(heir.contact_name)
        const relationship = toProperCase(heir.relationship || 'Associated person')
        const phoneType = phone?.type ? phone.type.toLowerCase() : 'phone'
        const canCall = Boolean(phone && isAutoCallablePhone(phone))
        return <article key={heir.key} className="min-w-0 rounded-xl border border-[var(--prospecting-border)] bg-[var(--prospecting-elevated)] p-3">
          <p className="truncate text-sm font-semibold text-[var(--ck-text)]">{displayName}</p>
          <p className="mt-1 min-h-8 text-[10px] leading-4 text-[var(--ck-text-muted)]">{relationship}{verifiedPhone ? ` · verified ${phoneType}` : phone ? ` · ${phoneType}` : ''}</p>
          <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-[11px] tabular-nums text-[var(--ck-text)]">{phone ? formatPhone(phone.number) || phone.number : 'No phone'}</span>
            <button
              type="button"
              onClick={() => { if (phone) queueOne(heir, phone) }}
              disabled={readOnlyPreview || !canCall}
              aria-label={phone ? `Call ${displayName} at ${formatPhone(phone.number) || phone.number}` : `No callable phone for ${displayName}`}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-[var(--prospecting-primary)] px-2.5 text-xs font-semibold text-[var(--prospecting-on-primary)] transition-colors hover:bg-[var(--prospecting-primary-strong)] disabled:cursor-not-allowed"
            >
              <Icon name="call" size="text-sm" /> Call
            </button>
          </div>
        </article>
      })}
    </div> : null}
  </section>
}
