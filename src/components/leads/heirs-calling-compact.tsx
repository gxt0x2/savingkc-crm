'use client'

import { Icon } from '@/components/ui/icon'
import { formatPhone, toProperCase } from '@/lib/format'
import {
  isAutoCallablePhone,
  isVerifiedPhone,
  sourceProspectPhoneId,
  verifiedPhoneOf,
  type Heir,
  type HeirPhone,
} from '@/lib/heir-dialer-queue'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

type HeirsCallingCompactProps = {
  /** Prospect phone id from the live dialer queue, when one is being dialed. */
  activePhoneId?: string | null
  /** Dialed number, used when the queue item has no source phone id. */
  activePhoneNumber?: string | null
  callablePhonesForHeir: (heir: Heir) => HeirPhone[]
  error: string | null
  heirs: Heir[]
  loading: boolean
  queueOne: (heir: Heir, phone: HeirPhone) => void
  readOnlyPreview: boolean
  /**
   * Calling floor sets this so the card lists every callable number.
   * Without it, the card stays on the single primary/verified number.
   */
  showAllPhones?: boolean
}

function isCurrentDialPhone(
  phone: HeirPhone,
  activePhoneId: string | null,
  activePhoneNumber: string | null,
): boolean {
  if (activePhoneId) {
    return phone.id === activePhoneId
      || phone.prospect_phone_id === activePhoneId
      || sourceProspectPhoneId(phone) === activePhoneId
  }
  if (!activePhoneNumber) return false
  const current = normalizePhoneToE164(activePhoneNumber)
  const candidate = normalizePhoneToE164(phone.number)
  return Boolean(current && candidate && current === candidate)
}

function CompactCallButton({
  canCall,
  displayName,
  onCall,
  phone,
  readOnlyPreview,
}: {
  canCall: boolean
  displayName: string
  onCall: () => void
  phone: HeirPhone | null
  readOnlyPreview: boolean
}) {
  const formatted = phone ? formatPhone(phone.number) || phone.number : ''
  return <button
    type="button"
    onClick={onCall}
    disabled={readOnlyPreview || !canCall}
    aria-label={phone ? `Call ${displayName} at ${formatted}` : `No callable phone for ${displayName}`}
    className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-[var(--prospecting-primary)] px-2.5 text-xs font-semibold text-[var(--prospecting-on-primary)] transition-colors hover:bg-[var(--prospecting-primary-strong)] disabled:cursor-not-allowed"
  >
    <Icon name="call" size="text-sm" /> Call
  </button>
}

export function HeirsCallingCompact({
  activePhoneId = null,
  activePhoneNumber = null,
  callablePhonesForHeir,
  error,
  heirs,
  loading,
  queueOne,
  readOnlyPreview,
  showAllPhones = false,
}: HeirsCallingCompactProps) {
  return <section aria-label="Callable people" className="border-b border-[var(--ck-border)] pb-4">
    {error ? <p role="alert" className="mb-3 rounded-lg border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-medium text-[var(--crm-danger)]">{error}</p> : null}
    {loading ? <div role="status" className="grid min-h-28 place-items-center"><Icon name="progress_activity" className="animate-spin text-xl text-[var(--ck-text-dim)]" /></div> : null}
    {!loading && heirs.length === 0 ? <p className="rounded-xl border border-[var(--ck-border)] bg-[var(--prospecting-elevated)] px-3 py-4 text-xs text-[var(--ck-text-muted)]">No callable people are attached to this record.</p> : null}
    {!loading && heirs.length > 0 ? <div className={`grid grid-cols-1 gap-2 ${heirs.length > 1 ? 'sm:grid-cols-2' : ''}`}>
      {heirs.map((heir) => {
        const verifiedPhone = verifiedPhoneOf(heir)
        const dialablePhones = callablePhonesForHeir(heir)
        const singlePhone = verifiedPhone ?? dialablePhones[0] ?? heir.phones[0] ?? null
        const phones = showAllPhones && dialablePhones.length > 0 ? dialablePhones : singlePhone ? [singlePhone] : []
        const listingEveryNumber = showAllPhones && dialablePhones.length > 0
        const displayName = toProperCase(heir.contact_name)
        const relationship = toProperCase(heir.relationship || 'Associated person')
        const phoneType = singlePhone?.type ? singlePhone.type.toLowerCase() : 'phone'
        return <article key={heir.key} aria-label={displayName} className="min-w-0 rounded-xl border border-[var(--prospecting-border)] bg-[var(--prospecting-elevated)] p-3">
          <p className="truncate text-sm font-semibold text-[var(--ck-text)]">{displayName}</p>
          <p className="mt-1 min-h-8 text-[10px] leading-4 text-[var(--ck-text-muted)]">{relationship}{listingEveryNumber ? '' : verifiedPhone ? ` · verified ${phoneType}` : singlePhone ? ` · ${phoneType}` : ''}</p>
          {listingEveryNumber ? <ul aria-label={`Phone numbers for ${displayName}`} className="mt-2 grid gap-1.5">
            {phones.map((phone, index) => {
              const formatted = formatPhone(phone.number) || phone.number
              const active = isCurrentDialPhone(phone, activePhoneId, activePhoneNumber)
              const typeLabel = phone.type ? phone.type.toLowerCase() : 'phone'
              const verified = isVerifiedPhone(phone)
              return <li
                key={phone.id}
                aria-current={active ? 'true' : undefined}
                className={`flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1.5 ${active ? 'bg-[var(--prospecting-primary-soft)] ring-1 ring-inset ring-[var(--prospecting-primary)]' : ''}`}
              >
                <div className="min-w-0">
                  <span className="block truncate font-mono text-[11px] tabular-nums text-[var(--ck-text)]">{formatted}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] leading-4 text-[var(--ck-text-muted)]">
                    <span>{typeLabel}{verified ? ' · verified' : ''}</span>
                    {phones.length > 1 ? <span>{index + 1} of {phones.length}</span> : null}
                    {active ? <span className="font-black uppercase tracking-wider text-[var(--prospecting-primary)]">Active</span> : null}
                  </span>
                </div>
                <CompactCallButton
                  canCall={isAutoCallablePhone(phone)}
                  displayName={displayName}
                  onCall={() => queueOne(heir, phone)}
                  phone={phone}
                  readOnlyPreview={readOnlyPreview}
                />
              </li>
            })}
          </ul> : <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-[11px] tabular-nums text-[var(--ck-text)]">{singlePhone ? formatPhone(singlePhone.number) || singlePhone.number : 'No phone'}</span>
            <CompactCallButton
              canCall={Boolean(singlePhone && isAutoCallablePhone(singlePhone))}
              displayName={displayName}
              onCall={() => { if (singlePhone) queueOne(heir, singlePhone) }}
              phone={singlePhone}
              readOnlyPreview={readOnlyPreview}
            />
          </div>}
        </article>
      })}
    </div> : null}
  </section>
}
