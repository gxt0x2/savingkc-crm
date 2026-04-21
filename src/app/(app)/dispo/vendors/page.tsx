'use client'

import { useState, useCallback, useEffect } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type VendorCategory =
  | 'contractor' | 'escrow' | 'title' | 'cleanout'
  | 'dumpster' | 'inspector' | 'appraiser' | 'attorney' | 'other'

type VendorStatus = 'active' | 'inactive'

interface Vendor {
  id: string
  name: string
  company_name: string | null
  category: VendorCategory
  phone: string | null
  phone_2: string | null
  email: string | null
  website: string | null
  address: string | null
  service_areas: string[]
  notes: string | null
  rating: number | null
  is_preferred: boolean
  status: VendorStatus
  tags: string[]
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CATEGORIES: { value: VendorCategory | 'all'; label: string; icon: string }[] = [
  { value: 'all',        label: 'All',        icon: 'apps' },
  { value: 'contractor', label: 'Contractor',  icon: 'construction' },
  { value: 'escrow',     label: 'Escrow',      icon: 'account_balance' },
  { value: 'title',      label: 'Title',       icon: 'gavel' },
  { value: 'cleanout',   label: 'Cleanout',    icon: 'cleaning_services' },
  { value: 'dumpster',   label: 'Dumpster',    icon: 'delete' },
  { value: 'inspector',  label: 'Inspector',   icon: 'search_check' },
  { value: 'appraiser',  label: 'Appraiser',   icon: 'price_check' },
  { value: 'attorney',   label: 'Attorney',    icon: 'balance' },
  { value: 'other',      label: 'Other',       icon: 'more_horiz' },
]

const CATEGORY_COLORS: Record<VendorCategory, string> = {
  contractor: 'bg-orange-500/20 text-orange-300',
  escrow:     'bg-sky-500/20 text-sky-300',
  title:      'bg-purple-500/20 text-purple-300',
  cleanout:   'bg-teal-500/20 text-teal-300',
  dumpster:   'bg-amber-500/20 text-amber-300',
  inspector:  'bg-cyan-500/20 text-cyan-300',
  appraiser:  'bg-indigo-500/20 text-indigo-300',
  attorney:   'bg-rose-500/20 text-rose-300',
  other:      'bg-slate-500/20 text-slate-300',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function StarRating({ rating, onChange }: { rating: number | null; onChange?: (r: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange?.(n)}
          className={cn(
            'text-base transition-colors',
            onChange ? 'cursor-pointer hover:text-yellow-400' : 'cursor-default',
            (rating ?? 0) >= n ? 'text-yellow-400' : 'text-slate-300'
          )}
        >
          <Icon name="star" size="text-base" />
        </button>
      ))}
    </div>
  )
}

function categoryLabel(cat: VendorCategory) {
  return CATEGORIES.find(c => c.value === cat)?.label ?? cat
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function fetchVendors(search: string, category: string) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (category && category !== 'all') params.set('category', category)
  const res = await fetch(`/api/vendors?${params}`)
  if (!res.ok) throw new Error('Failed to load vendors')
  return res.json() as Promise<{ vendors: Vendor[]; total: number }>
}

async function createVendor(data: Partial<Vendor>) {
  const res = await fetch('/api/vendors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const j = await res.json()
    throw new Error(j.error ?? 'Failed to create vendor')
  }
  return res.json()
}

async function updateVendor(data: Partial<Vendor> & { id: string }) {
  const res = await fetch('/api/vendors', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const j = await res.json()
    throw new Error(j.error ?? 'Failed to update vendor')
  }
  return res.json()
}

async function deleteVendors(ids: string[]) {
  const res = await fetch('/api/vendors', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  if (!res.ok) {
    const j = await res.json()
    throw new Error(j.error ?? 'Failed to delete vendors')
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Blank form
// ---------------------------------------------------------------------------
const BLANK_FORM = {
  name: '',
  company_name: '',
  category: 'contractor' as VendorCategory,
  phone: '',
  phone_2: '',
  email: '',
  website: '',
  address: '',
  service_areas: '',
  notes: '',
  rating: '' as '' | number,
  is_preferred: false,
  status: 'active' as VendorStatus,
  tags: '',
}

// ---------------------------------------------------------------------------
// Add Vendor Modal
// ---------------------------------------------------------------------------
interface AddVendorModalProps {
  onClose: () => void
  onSuccess: () => void
}

function AddVendorModal({ onClose, onSuccess }: AddVendorModalProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ ...BLANK_FORM })
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: createVendor,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendors'] })
      onSuccess()
    },
  })

  function set(field: string, val: unknown) {
    setForm(f => ({ ...f, [field]: val }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) { setError('Name is required.'); return }
    try {
      await mutation.mutateAsync({
        name: form.name.trim(),
        company_name: form.company_name.trim() || null,
        category: form.category,
        phone: form.phone.trim() || null,
        phone_2: form.phone_2.trim() || null,
        email: form.email.trim() || null,
        website: form.website.trim() || null,
        address: form.address.trim() || null,
        service_areas: form.service_areas.split(',').map(s => s.trim()).filter(Boolean),
        notes: form.notes.trim() || null,
        rating: form.rating ? Number(form.rating) : null,
        is_preferred: form.is_preferred,
        status: form.status,
        tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create vendor')
    }
  }

  const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20'
  const labelCls = 'block text-xs font-semibold text-slate-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Add Vendor</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className={labelCls}>Name *</label>
              <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Jane Smith" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className={labelCls}>Company</label>
              <input className={inputCls} value={form.company_name} onChange={e => set('company_name', e.target.value)} placeholder="Smith Contracting LLC" />
            </div>
          </div>

          <div>
            <label className={labelCls}>Category *</label>
            <select className={inputCls} value={form.category} onChange={e => set('category', e.target.value as VendorCategory)}>
              {CATEGORIES.filter(c => c.value !== 'all').map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Phone</label>
              <input type="tel" className={inputCls} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="816-555-0100" />
            </div>
            <div>
              <label className={labelCls}>Phone 2</label>
              <input type="tel" className={inputCls} value={form.phone_2} onChange={e => set('phone_2', e.target.value)} placeholder="816-555-0101" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" className={inputCls} value={form.email} onChange={e => set('email', e.target.value)} placeholder="jane@example.com" />
            </div>
            <div>
              <label className={labelCls}>Website</label>
              <input type="url" className={inputCls} value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://..." />
            </div>
          </div>

          <div>
            <label className={labelCls}>Address</label>
            <input className={inputCls} value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Main St, Kansas City, MO 64112" />
          </div>

          <div>
            <label className={labelCls}>Service Areas (comma-separated)</label>
            <input className={inputCls} value={form.service_areas} onChange={e => set('service_areas', e.target.value)} placeholder="Kansas City, Lee's Summit, Independence" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Rating</label>
              <StarRating rating={form.rating ? Number(form.rating) : null} onChange={r => set('rating', r)} />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select className={inputCls} value={form.status} onChange={e => set('status', e.target.value as VendorStatus)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_preferred"
              checked={form.is_preferred}
              onChange={e => set('is_preferred', e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            <label htmlFor="is_preferred" className="text-sm font-semibold text-slate-600 cursor-pointer">
              Mark as Preferred Vendor
            </label>
          </div>

          <div>
            <label className={labelCls}>Tags (comma-separated)</label>
            <input className={inputCls} value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="licensed, insured, fast" />
          </div>

          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              className={cn(inputCls, 'resize-none')}
              rows={3}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Additional notes..."
            />
          </div>

          <div className="flex gap-3 pt-2 pb-1">
            <button type="button" onClick={onClose} className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold">
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 bg-primary text-white hover:bg-primary/90 disabled:opacity-60 rounded-lg px-4 py-2 text-sm font-semibold"
            >
              {mutation.isPending ? 'Saving…' : 'Add Vendor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit Slide-Over Panel
// ---------------------------------------------------------------------------
interface EditPanelProps {
  vendor: Vendor
  onClose: () => void
}

function EditPanel({ vendor, onClose }: EditPanelProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: vendor.name,
    company_name: vendor.company_name ?? '',
    category: vendor.category,
    phone: vendor.phone ?? '',
    phone_2: vendor.phone_2 ?? '',
    email: vendor.email ?? '',
    website: vendor.website ?? '',
    address: vendor.address ?? '',
    service_areas: vendor.service_areas.join(', '),
    notes: vendor.notes ?? '',
    rating: vendor.rating ?? ('' as '' | number),
    is_preferred: vendor.is_preferred,
    status: vendor.status,
    tags: vendor.tags.join(', '),
  })
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const updateMutation = useMutation({
    mutationFn: updateVendor,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendors'] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteVendors,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendors'] })
      onClose()
    },
  })

  function set(field: string, val: unknown) {
    setForm(f => ({ ...f, [field]: val }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) { setError('Name is required.'); return }
    try {
      await updateMutation.mutateAsync({
        id: vendor.id,
        name: form.name.trim(),
        company_name: form.company_name.trim() || null,
        category: form.category,
        phone: form.phone.trim() || null,
        phone_2: form.phone_2.trim() || null,
        email: form.email.trim() || null,
        website: form.website.trim() || null,
        address: form.address.trim() || null,
        service_areas: form.service_areas.split(',').map(s => s.trim()).filter(Boolean),
        notes: form.notes.trim() || null,
        rating: form.rating ? Number(form.rating) : null,
        is_preferred: form.is_preferred,
        status: form.status,
        tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update vendor')
    }
  }

  const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20'
  const labelCls = 'block text-xs font-semibold text-slate-600 mb-1'

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full z-50 w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">{vendor.name}</h2>
            {vendor.company_name && <p className="text-xs text-slate-500">{vendor.company_name}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <form onSubmit={handleSave} className="space-y-4" id="edit-vendor-form">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Name *</label>
                <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Company</label>
                <input className={inputCls} value={form.company_name} onChange={e => set('company_name', e.target.value)} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Category *</label>
              <select className={inputCls} value={form.category} onChange={e => set('category', e.target.value as VendorCategory)}>
                {CATEGORIES.filter(c => c.value !== 'all').map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Phone</label>
                <input type="tel" className={inputCls} value={form.phone} onChange={e => set('phone', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Phone 2</label>
                <input type="tel" className={inputCls} value={form.phone_2} onChange={e => set('phone_2', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Email</label>
                <input type="email" className={inputCls} value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Website</label>
                <input type="url" className={inputCls} value={form.website} onChange={e => set('website', e.target.value)} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Address</label>
              <input className={inputCls} value={form.address} onChange={e => set('address', e.target.value)} />
            </div>

            <div>
              <label className={labelCls}>Service Areas (comma-separated)</label>
              <input className={inputCls} value={form.service_areas} onChange={e => set('service_areas', e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Rating</label>
                <StarRating rating={form.rating ? Number(form.rating) : null} onChange={r => set('rating', r)} />
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select className={inputCls} value={form.status} onChange={e => set('status', e.target.value as VendorStatus)}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="edit_is_preferred"
                checked={form.is_preferred}
                onChange={e => set('is_preferred', e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <label htmlFor="edit_is_preferred" className="text-sm font-semibold text-slate-600 cursor-pointer">
                Preferred Vendor
              </label>
            </div>

            <div>
              <label className={labelCls}>Tags (comma-separated)</label>
              <input className={inputCls} value={form.tags} onChange={e => set('tags', e.target.value)} />
            </div>

            <div>
              <label className={labelCls}>Notes</label>
              <textarea
                className={cn(inputCls, 'resize-none')}
                rows={4}
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
              />
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-slate-100 space-y-3">
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold">
              Cancel
            </button>
            <button
              type="submit"
              form="edit-vendor-form"
              disabled={updateMutation.isPending}
              className="flex-1 bg-primary text-white hover:bg-primary/90 disabled:opacity-60 rounded-lg px-4 py-2 text-sm font-semibold"
            >
              {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>

          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="w-full text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
            >
              Delete Vendor
            </button>
          ) : (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate([vendor.id])}
                disabled={deleteMutation.isPending}
                className="flex-1 bg-red-500 text-white hover:bg-red-600 disabled:opacity-60 rounded-lg px-4 py-2 text-sm font-semibold"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Confirm Delete'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function VendorsPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState<Vendor | null>(null)

  const qc = useQueryClient()

  const debouncedSearch = useDebounce(search, 300)

  const { data, isLoading } = useQuery({
    queryKey: ['vendors', debouncedSearch, category],
    queryFn: () => fetchVendors(debouncedSearch, category),
  })

  const vendors = data?.vendors ?? []
  const total = data?.total ?? 0

  const handleSuccess = useCallback(() => {
    setShowAdd(false)
    qc.invalidateQueries({ queryKey: ['vendors'] })
  }, [qc])

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-primary tracking-tight">Vendors</h1>
          <p className="text-sm text-[var(--ck-text-muted)] mt-0.5">
            {total} vendor{total !== 1 ? 's' : ''} — contractors, title, escrow &amp; more
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-bold shadow-sm transition-colors"
        >
          <Icon name="add" size="text-lg" />
          Add Vendor
        </button>
      </div>

      {/* Search + Category Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Icon name="search" size="text-lg" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ck-text-dim)]" />
          <input
            className="w-full bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] rounded-lg pl-9 pr-4 py-2 text-sm text-[var(--ck-text)] placeholder:text-[var(--ck-text-muted)] focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Search vendors…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        {CATEGORIES.map(c => (
          <button
            key={c.value}
            onClick={() => setCategory(c.value)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors',
              category === c.value
                ? 'bg-primary text-white border-primary'
                : 'bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)] border-[var(--ck-border)] hover:border-primary/50 hover:text-[var(--ck-text)]'
            )}
          >
            <Icon name={c.icon} size="text-sm" />
            {c.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="ck-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-[var(--ck-text-muted)]">
            <Icon name="progress_activity" size="text-2xl" className="animate-spin mr-2" />
            Loading vendors…
          </div>
        ) : vendors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--ck-text-muted)]">
            <Icon name="store" size="text-4xl" className="mb-3 opacity-30" />
            <p className="font-semibold">No vendors found</p>
            <p className="text-sm mt-1">Add your first vendor to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--ck-border)]">
                  <th className="text-left px-4 py-3 text-xs font-bold text-[var(--ck-text-muted)] uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-[var(--ck-text-muted)] uppercase tracking-wider hidden sm:table-cell">Company</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-[var(--ck-text-muted)] uppercase tracking-wider">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-[var(--ck-text-muted)] uppercase tracking-wider hidden md:table-cell">Phone</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-[var(--ck-text-muted)] uppercase tracking-wider hidden lg:table-cell">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-[var(--ck-text-muted)] uppercase tracking-wider hidden md:table-cell">Rating</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-[var(--ck-text-muted)] uppercase tracking-wider hidden sm:table-cell">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ck-border)]">
                {vendors.map(v => (
                  <tr
                    key={v.id}
                    onClick={() => setSelected(v)}
                    className="cursor-pointer hover:bg-white/5 transition-colors"
                  >
                    {/* Name + preferred badge */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[var(--ck-text)]">{v.name}</span>
                        {v.is_preferred && (
                          <span className="inline-flex items-center gap-0.5 bg-amber-500/20 text-amber-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                            <Icon name="star" size="text-[10px]" />
                            Preferred
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Company */}
                    <td className="px-4 py-3 text-[var(--ck-text-muted)] hidden sm:table-cell">
                      {v.company_name ?? <span className="text-[var(--ck-text-dim)]">—</span>}
                    </td>

                    {/* Category badge */}
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-bold', CATEGORY_COLORS[v.category])}>
                        {categoryLabel(v.category)}
                      </span>
                    </td>

                    {/* Phone */}
                    <td className="px-4 py-3 text-[var(--ck-text-muted)] hidden md:table-cell">
                      {v.phone ? (
                        <a
                          href={`tel:${v.phone}`}
                          onClick={e => e.stopPropagation()}
                          className="hover:text-primary transition-colors"
                        >
                          {v.phone}
                        </a>
                      ) : <span className="text-[var(--ck-text-dim)]">—</span>}
                    </td>

                    {/* Email */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {v.email ? (
                        <a
                          href={`mailto:${v.email}`}
                          onClick={e => e.stopPropagation()}
                          className="text-primary hover:underline text-sm"
                        >
                          {v.email}
                        </a>
                      ) : <span className="text-[var(--ck-text-dim)]">—</span>}
                    </td>

                    {/* Rating */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      {v.rating ? <StarRating rating={v.rating} /> : <span className="text-[var(--ck-text-dim)]">—</span>}
                    </td>

                    {/* Status dot */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          'w-2 h-2 rounded-full flex-shrink-0',
                          v.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'
                        )} />
                        <span className={cn(
                          'text-xs font-semibold capitalize',
                          v.status === 'active' ? 'text-emerald-400' : 'text-slate-500'
                        )}>
                          {v.status}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showAdd && <AddVendorModal onClose={() => setShowAdd(false)} onSuccess={handleSuccess} />}
      {selected && <EditPanel vendor={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// useDebounce hook
// ---------------------------------------------------------------------------
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
