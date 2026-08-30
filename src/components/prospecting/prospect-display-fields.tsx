import type { OwnerAddressDisplay, OwnerDisplayParts } from '@/lib/owner-display'

function DisplayCell({ label, value, wide = false }: { label: string; value: string | null; wide?: boolean }) {
  return (
    <div className={`min-w-0 rounded-md border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1.5 ${wide ? 'col-span-2' : ''}`}>
      <p className="text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">{label}</p>
      <p className="truncate text-sm font-bold text-[var(--ck-text)]">{value || '—'}</p>
    </div>
  )
}

export function ProspectOwnerNameFields({ owner }: { owner: OwnerDisplayParts }) {
  return (
    <div aria-label="Owner name cells" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      <DisplayCell label="First" value={owner.first} />
      <DisplayCell label="MI" value={owner.mi} />
      <DisplayCell label="Last" value={owner.last} />
      <DisplayCell label="Suffix" value={owner.suffix} />
    </div>
  )
}

export function ProspectAddressFields({
  label,
  address,
}: {
  label: string
  address: OwnerAddressDisplay
}) {
  return (
    <div aria-label={label} className="space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        <DisplayCell label="Street" value={address.street} wide />
        <DisplayCell label="Unit" value={address.unit} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <DisplayCell label="City" value={address.city} />
        <DisplayCell label="State" value={address.state} />
        <DisplayCell label="Zip" value={address.zip} />
      </div>
    </div>
  )
}
