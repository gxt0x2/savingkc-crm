// Document type taxonomy — keep in sync with the dropdown in
// <DocumentManager />. Adding a new type is a one-liner; the DB column is
// plain TEXT so no migration needed.
export const DOC_TYPES = [
  { value: 'purchase_contract', label: 'Purchase Contract', side: 'acquisitions' },
  { value: 'assignment_contract', label: 'Assignment Contract', side: 'dispositions' },
  { value: 'addendum', label: 'Addendum', side: 'both' },
  { value: 'seller_disclosure', label: 'Seller Disclosure', side: 'acquisitions' },
  { value: 'title_commitment', label: 'Title Commitment', side: 'both' },
  { value: 'title_report', label: 'Title Report', side: 'both' },
  { value: 'inspection', label: 'Inspection Report', side: 'both' },
  { value: 'proof_of_funds', label: 'Proof of Funds', side: 'dispositions' },
  { value: 'comps', label: 'Comps / ARV Report', side: 'acquisitions' },
  { value: 'photos', label: 'Photos', side: 'both' },
  { value: 'closing_docs', label: 'Closing Documents', side: 'both' },
  { value: 'escrow_instructions', label: 'Escrow Instructions', side: 'dispositions' },
  { value: 'other', label: 'Other', side: 'both' },
] as const

export type DocType = (typeof DOC_TYPES)[number]['value']
export type EntityType = 'lead' | 'offer' | 'buyer' | 'deal' | 'dispo_deal'

export function docTypeLabel(t: string): string {
  return DOC_TYPES.find(d => d.value === t)?.label ?? t
}

// Material Symbols icon name for a doc type — one glance = doc kind.
export function docTypeIcon(t: string): string {
  switch (t) {
    case 'purchase_contract':
    case 'assignment_contract':
    case 'addendum':
    case 'closing_docs':
      return 'description'
    case 'seller_disclosure':
      return 'report'
    case 'title_commitment':
    case 'title_report':
      return 'gavel'
    case 'inspection':
      return 'home_work'
    case 'proof_of_funds':
      return 'account_balance'
    case 'comps':
      return 'analytics'
    case 'photos':
      return 'photo_library'
    case 'escrow_instructions':
      return 'lock'
    default:
      return 'attach_file'
  }
}

export interface DocumentRow {
  id: string
  entity_type: EntityType
  entity_id: string
  doc_type: string
  filename: string
  storage_path: string
  mime_type: string | null
  byte_size: number | null
  notes: string | null
  uploaded_by: string | null
  uploaded_at: string
}

export const DOCUMENTS_BUCKET = 'deal-documents'

// Build a safe storage path. Keeps the original extension for MIME detection.
export function buildStoragePath(entityType: EntityType, entityId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 120)
  return `${entityType}/${entityId}/${Date.now()}-${safe}`
}

export function formatBytes(n: number | null): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
