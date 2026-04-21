'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn, formatCurrency } from '@/lib/utils'
import {
  useBuyers,
  useCreateBuyer,
  useUpdateBuyer,
  useDeleteBuyers,
  useImportBuyers,
} from '@/hooks/use-buyers'
import type { Buyer, BuyBox } from '@/types/dispo'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PROPERTY_TYPES = ['SFR', 'Multi-Family', 'Condo', 'Townhouse', 'Land', 'Commercial', 'Mobile Home']
const FUNDING_TYPES = ['Cash', 'Hard Money', 'Conventional', 'Private Money', 'Seller Finance', 'Other']

function formatBuyBox(bb: BuyBox): string {
  const parts: string[] = []
  if (bb.zip_codes?.length) parts.push(bb.zip_codes.slice(0, 3).join(', ') + (bb.zip_codes.length > 3 ? '…' : ''))
  if (bb.price_min != null || bb.price_max != null) {
    const lo = bb.price_min != null ? formatCurrency(bb.price_min) : '?'
    const hi = bb.price_max != null ? formatCurrency(bb.price_max) : '?'
    parts.push(`${lo}–${hi}`)
  }
  if (bb.property_types?.length) parts.push(bb.property_types.join(', '))
  return parts.join(' | ') || '—'
}

function tierBadge(tier: string) {
  const map: Record<string, string> = {
    VIP: 'bg-yellow-100 text-yellow-700',
    Standard: 'bg-blue-100 text-blue-700',
    New: 'bg-slate-100 text-slate-600',
  }
  return map[tier] ?? 'bg-slate-100 text-slate-600'
}

function statusDot(status: Buyer['status']) {
  const map: Record<Buyer['status'], string> = {
    active: 'bg-emerald-500',
    inactive: 'bg-slate-400',
    blacklisted: 'bg-red-500',
  }
  return map[status]
}

// ---------------------------------------------------------------------------
// Add Buyer Modal
// ---------------------------------------------------------------------------
interface AddBuyerModalProps {
  onClose: () => void
  onSuccess: () => void
}

function AddBuyerModal({ onClose, onSuccess }: AddBuyerModalProps) {
  const createBuyer = useCreateBuyer()
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    company_name: '',
    email: '',
    phone: '',
    zip_codes: '',
    cities: '',
    price_min: '',
    price_max: '',
    property_types: [] as string[],
    funding_type: '',
    tags: '',
    notes: '',
  })
  const [error, setError] = useState<string | null>(null)

  function set(field: string, val: string | string[]) {
    setForm(f => ({ ...f, [field]: val }))
  }

  function togglePropType(pt: string) {
    set('property_types', form.property_types.includes(pt)
      ? form.property_types.filter(x => x !== pt)
      : [...form.property_types, pt])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('First and last name are required.')
      return
    }
    const buy_box: BuyBox = {
      zip_codes: form.zip_codes.split(',').map(s => s.trim()).filter(Boolean),
      cities: form.cities.split(',').map(s => s.trim()).filter(Boolean),
      price_min: form.price_min ? Number(form.price_min) : undefined,
      price_max: form.price_max ? Number(form.price_max) : undefined,
      property_types: form.property_types,
    }
    try {
      await createBuyer.mutateAsync({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        company_name: form.company_name.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        buy_box,
        funding_type: form.funding_type || null,
        tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
        notes: form.notes.trim() || null,
        status: 'active',
        tier: 'New',
      })
      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create buyer')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Add Buyer</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
            <Icon name="close" size="text-lg" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">First Name *</label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={form.first_name}
                onChange={e => set('first_name', e.target.value)}
                placeholder="John"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Last Name *</label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={form.last_name}
                onChange={e => set('last_name', e.target.value)}
                placeholder="Smith"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Company</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={form.company_name}
              onChange={e => set('company_name', e.target.value)}
              placeholder="Smith Investments LLC"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
              <input
                type="email"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Phone</label>
              <input
                type="tel"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                placeholder="816-555-0100"
              />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">Buy Box</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Zip Codes (comma-separated)</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  value={form.zip_codes}
                  onChange={e => set('zip_codes', e.target.value)}
                  placeholder="64112, 64113, 64114"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Cities (comma-separated)</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  value={form.cities}
                  onChange={e => set('cities', e.target.value)}
                  placeholder="Kansas City, Lee's Summit"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Min Price</label>
                  <input
                    type="number"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={form.price_min}
                    onChange={e => set('price_min', e.target.value)}
                    placeholder="50000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Max Price</label>
                  <input
                    type="number"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={form.price_max}
                    onChange={e => set('price_max', e.target.value)}
                    placeholder="300000"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Property Types</label>
                <div className="flex flex-wrap gap-2">
                  {PROPERTY_TYPES.map(pt => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => togglePropType(pt)}
                      className={cn(
                        'px-3 py-1 rounded-full text-xs font-semibold border transition-colors',
                        form.property_types.includes(pt)
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-primary/50'
                      )}
                    >
                      {pt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Funding Type</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={form.funding_type}
              onChange={e => set('funding_type', e.target.value)}
            >
              <option value="">Select funding type...</option>
              {FUNDING_TYPES.map(ft => <option key={ft} value={ft}>{ft}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Tags (comma-separated)</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={form.tags}
              onChange={e => set('tags', e.target.value)}
              placeholder="cash buyer, repeat, kcmo"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              rows={3}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Additional notes about this buyer..."
            />
          </div>

          <div className="flex gap-3 pt-2 pb-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createBuyer.isPending}
              className="flex-1 bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {createBuyer.isPending ? 'Saving…' : 'Add Buyer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Import Buyer Modal
// ---------------------------------------------------------------------------
interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

function ImportBuyerModal({ onClose }: { onClose: () => void }) {
  const importBuyers = useImportBuyers()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string[][]>([])
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function parseCSVPreview(f: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const lines = text.split('\n').slice(0, 4).filter(Boolean)
      setPreview(lines.map(l => l.split(',').map(s => s.trim().replace(/^"|"$/g, ''))))
    }
    reader.readAsText(f)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)
    parseCSVPreview(f)
  }

  async function handleImport() {
    if (!file) return
    setError(null)
    try {
      const res = await importBuyers.mutateAsync(file)
      setResult(res)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed')
    }
  }

  const headers = preview[0] ?? []
  const rows = preview.slice(1, 4)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Import Buyers CSV</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
            <Icon name="close" size="text-lg" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          {result ? (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-green-800 mb-1">Import Complete</p>
                <p className="text-sm text-green-700">{result.imported} imported, {result.skipped} skipped</p>
              </div>
              {result.errors.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 max-h-40 overflow-y-auto">
                  <p className="text-xs font-semibold text-yellow-800 mb-1">Errors ({result.errors.length})</p>
                  {result.errors.map((err, i) => (
                    <p key={i} className="text-xs text-yellow-700">{err}</p>
                  ))}
                </div>
              )}
              <button
                onClick={onClose}
                className="w-full bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">CSV File</label>
                <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-primary/50 hover:bg-slate-50 transition-colors">
                  <Icon name="upload_file" size="text-2xl" className="text-slate-400 mb-1" />
                  <span className="text-sm text-slate-500">{file ? file.name : 'Click to upload CSV'}</span>
                  <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
                </label>
              </div>

              {preview.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-2">Preview (first 3 rows)</p>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          {headers.map((h, i) => (
                            <th key={i} className="px-2 py-1.5 text-left font-bold text-slate-600 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, ri) => (
                          <tr key={ri} className="border-b border-slate-100 last:border-0">
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-2 py-1.5 text-slate-600 whitespace-nowrap max-w-[120px] truncate">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={!file || importBuyers.isPending}
                  className="flex-1 bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  {importBuyers.isPending ? 'Importing…' : 'Import'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Buyer Slide-Over Panel
// ---------------------------------------------------------------------------
interface BuyerPanelProps {
  buyer: Buyer
  onClose: () => void
  onSaved: () => void
}

function BuyerPanel({ buyer, onClose, onSaved }: BuyerPanelProps) {
  const updateBuyer = useUpdateBuyer()
  const deleteBuyers = useDeleteBuyers()
  const [form, setForm] = useState({
    notes: buyer.notes ?? '',
    tags: buyer.tags.join(', '),
    status: buyer.status,
    tier: buyer.tier,
  })
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  function setField(field: string, val: string) {
    setForm(f => ({ ...f, [field]: val }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateBuyer.mutateAsync({
        id: buyer.id,
        notes: form.notes || null,
        tags: form.tags.split(',').map(s => s.trim()).filter(Boolean),
        status: form.status as Buyer['status'],
        tier: form.tier,
      })
      setFeedback('Saved')
      setTimeout(() => { setFeedback(null); onSaved() }, 1000)
    } catch {
      setFeedback('Error saving')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete ${buyer.first_name} ${buyer.last_name}? This cannot be undone.`)) return
    await deleteBuyers.mutateAsync([buyer.id])
    onSaved()
    onClose()
  }

  const bb = buyer.buy_box

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-96 h-full bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-bold text-slate-900 text-base">{buyer.first_name} {buyer.last_name}</h2>
            {buyer.company_name && <p className="text-xs text-slate-500">{buyer.company_name}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
            <Icon name="close" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Contact Info */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Contact</p>
            <div className="space-y-1.5">
              {buyer.phone && (
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Icon name="call" size="text-sm" className="text-slate-400" />
                  {buyer.phone}
                </div>
              )}
              {buyer.phone_2 && (
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Icon name="phone_forwarded" size="text-sm" className="text-slate-400" />
                  {buyer.phone_2}
                </div>
              )}
              {buyer.email && (
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Icon name="mail" size="text-sm" className="text-slate-400" />
                  {buyer.email}
                </div>
              )}
            </div>
          </div>

          {/* Buy Box */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Buy Box</p>
            <div className="bg-slate-50 rounded-lg p-3 space-y-1.5 text-sm text-slate-700">
              {bb.zip_codes?.length ? (
                <div><span className="text-xs font-semibold text-slate-500">Zips: </span>{bb.zip_codes.join(', ')}</div>
              ) : null}
              {bb.cities?.length ? (
                <div><span className="text-xs font-semibold text-slate-500">Cities: </span>{bb.cities.join(', ')}</div>
              ) : null}
              {(bb.price_min != null || bb.price_max != null) && (
                <div>
                  <span className="text-xs font-semibold text-slate-500">Price: </span>
                  {bb.price_min != null ? formatCurrency(bb.price_min) : '?'} – {bb.price_max != null ? formatCurrency(bb.price_max) : '?'}
                </div>
              )}
              {bb.property_types?.length ? (
                <div><span className="text-xs font-semibold text-slate-500">Types: </span>{bb.property_types.join(', ')}</div>
              ) : null}
              {!bb.zip_codes?.length && !bb.cities?.length && !bb.price_min && !bb.price_max && (
                <p className="text-slate-400 italic text-xs">No buy box set</p>
              )}
            </div>
          </div>

          {/* Stats */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Stats</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-slate-900">{buyer.deals_closed}</p>
                <p className="text-xs text-slate-500 mt-0.5">Deals Closed</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-slate-900">{buyer.funding_type ?? '—'}</p>
                <p className="text-xs text-slate-500 mt-0.5">Funding</p>
              </div>
            </div>
          </div>

          {/* Status & Tier */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={form.status}
                onChange={e => setField('status', e.target.value)}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="blacklisted">Blacklisted</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Tier</label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={form.tier}
                onChange={e => setField('tier', e.target.value)}
              >
                <option value="New">New</option>
                <option value="Standard">Standard</option>
                <option value="VIP">VIP</option>
              </select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Tags (comma-separated)</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={form.tags}
              onChange={e => setField('tags', e.target.value)}
              placeholder="cash, repeat, kcmo"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              rows={4}
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 space-y-2">
          {feedback && (
            <p className={cn('text-center text-xs font-semibold', feedback === 'Saved' ? 'text-emerald-600' : 'text-red-600')}>
              {feedback}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleteBuyers.isPending}
              className="px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors disabled:opacity-50"
            >
              <Icon name="delete" size="text-sm" />
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
const PAGE_SIZE = 25

export default function BuyersPage() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [page, setPage] = useState(1)
  const [selectedBuyerId, setSelectedBuyerId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false)
  const bulkRef = useRef<HTMLDivElement>(null)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading, refetch } = useBuyers({
    search: debouncedSearch,
    status: statusFilter,
    tier: tierFilter,
    page,
    limit: PAGE_SIZE,
  })

  const deleteBuyers = useDeleteBuyers()
  const updateBuyer = useUpdateBuyer()

  const buyers = data?.buyers ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const selectedBuyer = buyers.find(b => b.id === selectedBuyerId) ?? null

  // Close bulk dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bulkRef.current && !bulkRef.current.contains(e.target as Node)) setBulkStatusOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Clear selection when filters change
  useEffect(() => { setSelectedIds(new Set()) }, [debouncedSearch, statusFilter, tierFilter, page])

  const allSelected = buyers.length > 0 && buyers.every(b => selectedIds.has(b.id))
  const someSelected = buyers.some(b => selectedIds.has(b.id))

  const headerCheckboxRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelected && !allSelected
    }
  }, [someSelected, allSelected])

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(prev => { const next = new Set(prev); buyers.forEach(b => next.delete(b.id)); return next })
    } else {
      setSelectedIds(prev => { const next = new Set(prev); buyers.forEach(b => next.add(b.id)); return next })
    }
  }

  async function handleBulkDelete() {
    const count = selectedIds.size
    if (!window.confirm(`Delete ${count} buyer${count !== 1 ? 's' : ''}? This cannot be undone.`)) return
    await deleteBuyers.mutateAsync(Array.from(selectedIds))
    setSelectedIds(new Set())
    refetch()
  }

  const handleBulkStatus = useCallback(async (status: Buyer['status']) => {
    setBulkStatusOpen(false)
    const ids = Array.from(selectedIds)
    await Promise.all(ids.map(id => updateBuyer.mutateAsync({ id, status })))
    setSelectedIds(new Set())
    refetch()
  }, [selectedIds, updateBuyer, refetch])

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-6 pb-32 max-w-[1440px] mx-auto">
      {showAdd && (
        <AddBuyerModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); refetch() }}
        />
      )}
      {showImport && <ImportBuyerModal onClose={() => { setShowImport(false); refetch() }} />}
      {selectedBuyer && (
        <BuyerPanel
          buyer={selectedBuyer}
          onClose={() => setSelectedBuyerId(null)}
          onSaved={() => { setSelectedBuyerId(null); refetch() }}
        />
      )}

      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary mb-1">Buyers</h1>
          <p className="text-slate-500 text-sm">
            {isLoading ? 'Loading…' : `${total.toLocaleString()} buyer${total !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold"
          >
            <Icon name="upload" size="text-sm" />
            Import CSV
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold"
          >
            <Icon name="add" size="text-sm" />
            Add Buyer
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4 relative max-w-sm">
        <span className="absolute inset-y-0 left-3 flex items-center text-slate-400">
          <Icon name="search" size="text-lg" />
        </span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-slate-200 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="Search buyers by name, company, phone..."
        />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        {/* Status pills */}
        <div className="flex items-center gap-1">
          {(['', 'active', 'inactive', 'blacklisted'] as const).map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1) }}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
                statusFilter === s
                  ? 'bg-primary text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              )}
            >
              {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="w-px bg-slate-200 self-stretch" />
        {/* Tier pills */}
        <div className="flex items-center gap-1">
          {(['', 'VIP', 'Standard', 'New'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTierFilter(t); setPage(1) }}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
                tierFilter === t
                  ? 'bg-primary text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              )}
            >
              {t === '' ? 'All Tiers' : t}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-slate-400 py-16 text-center">Loading buyers...</div>
      ) : buyers.length === 0 ? (
        <div className="text-center py-16">
          <Icon name="group" className="text-4xl text-slate-300 mb-3" />
          <p className="text-slate-400 font-medium">No buyers found</p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-4 bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold"
          >
            Add your first buyer
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="w-10 px-3 py-3">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300 cursor-pointer"
                    />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden md:table-cell">Company</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Phone</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden xl:table-cell">Buy Box</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Tier</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Deals</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {buyers.map(buyer => (
                  <tr
                    key={buyer.id}
                    className={cn(
                      'hover:bg-slate-50 transition-colors cursor-pointer',
                      selectedIds.has(buyer.id) && 'bg-primary/5',
                      selectedBuyerId === buyer.id && 'bg-primary/10'
                    )}
                    onClick={() => setSelectedBuyerId(buyer.id === selectedBuyerId ? null : buyer.id)}
                  >
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(buyer.id)}
                        onChange={() => toggleSelect(buyer.id)}
                        className="rounded border-slate-300 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                      {buyer.first_name} {buyer.last_name}
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{buyer.company_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{buyer.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 hidden lg:table-cell truncate max-w-[180px]">{buyer.email ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs hidden xl:table-cell max-w-[220px] truncate">
                      {formatBuyBox(buyer.buy_box)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold', tierBadge(buyer.tier))}>
                        {buyer.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-medium hidden sm:table-cell">{buyer.deals_closed}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', statusDot(buyer.status))} />
                        <span className="capitalize hidden sm:inline">{buyer.status}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex gap-1">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <Icon name="chevron_left" size="text-sm" />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              const pg = i + 1
              return (
                <button
                  key={pg}
                  onClick={() => setPage(pg)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg border text-sm font-medium',
                    page === pg
                      ? 'bg-primary text-white border-primary'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  )}
                >
                  {pg}
                </button>
              )
            })}
            <button
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <Icon name="chevron_right" size="text-sm" />
            </button>
          </div>
        </div>
      )}

      {/* Floating Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4">
          <span className="text-sm font-semibold whitespace-nowrap">{selectedIds.size} selected</span>
          <div className="h-5 w-px bg-slate-600" />

          <div className="relative" ref={bulkRef}>
            <button
              onClick={() => setBulkStatusOpen(v => !v)}
              className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition whitespace-nowrap"
            >
              <Icon name="swap_horiz" size="text-sm" className="mr-1 align-middle" />
              Status
            </button>
            {bulkStatusOpen && (
              <div className="absolute bottom-full mb-2 left-0 bg-white text-slate-900 rounded-lg shadow-xl border border-slate-200 py-1 min-w-[160px]">
                {(['active', 'inactive', 'blacklisted'] as Buyer['status'][]).map(s => (
                  <button
                    key={s}
                    onClick={() => handleBulkStatus(s)}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-100 capitalize"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleBulkDelete}
            disabled={deleteBuyers.isPending}
            className="text-sm px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
          >
            <Icon name="delete" size="text-sm" /> Delete
          </button>

          <div className="h-5 w-px bg-slate-600" />
          <button
            onClick={() => setSelectedIds(new Set())}
            className="p-1.5 hover:bg-slate-700 rounded-lg transition"
            title="Clear selection"
          >
            <Icon name="close" size="text-sm" />
          </button>
        </div>
      )}
    </div>
  )
}
