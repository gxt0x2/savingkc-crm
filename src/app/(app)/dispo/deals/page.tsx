'use client'

import { useState, useEffect, useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { DealPage, InspectionReport } from '@/types/dispo'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getDealPageUrl(slug: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm.savingkc.com'}/deals/${slug}`
}

// ---------------------------------------------------------------------------
// Create Deal Page Modal
// ---------------------------------------------------------------------------
interface Lead {
  id: string
  property_address: string | null
  full_name: string | null
}

function CreateDealPageModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [leadSearch, setLeadSearch] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [showAddress, setShowAddress] = useState(true)
  const [showArv, setShowArv] = useState(true)
  const [showAskingPrice, setShowAskingPrice] = useState(true)
  const [showAssignmentFee, setShowAssignmentFee] = useState(false)
  const [acceptOffers, setAcceptOffers] = useState(true)
  const [requiresRegistration, setRequiresRegistration] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Contract terms
  const [contractCloseDate, setContractCloseDate] = useState('')
  const [earnestMoney, setEarnestMoney] = useState('')
  const [inspectionPeriodDays, setInspectionPeriodDays] = useState('')
  const [financingTerms, setFinancingTerms] = useState('')
  const [repairEstimateLow, setRepairEstimateLow] = useState('')
  const [repairEstimateHigh, setRepairEstimateHigh] = useState('')
  const [propertyCondition, setPropertyCondition] = useState('')
  const [parking, setParking] = useState('')
  const [contractNotes, setContractNotes] = useState('')
  const [assignmentFee, setAssignmentFee] = useState('')
  // File uploads
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [uploadingReport, setUploadingReport] = useState(false)
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([])
  const [pendingReports, setPendingReports] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)

  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const reportInputRef = useRef<HTMLInputElement | null>(null)

  function handlePhotoFiles(files: FileList | null) {
    if (!files) return
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'))
    setPendingPhotos(prev => [...prev, ...arr])
    arr.forEach(f => {
      const reader = new FileReader()
      reader.onload = e => setPhotoPreviews(prev => [...prev, e.target?.result as string])
      reader.readAsDataURL(f)
    })
  }

  function handleReportFiles(files: FileList | null) {
    if (!files) return
    const arr = Array.from(files).filter(f => f.type === 'application/pdf')
    setPendingReports(prev => [...prev, ...arr])
  }

  function removePhoto(idx: number) {
    setPendingPhotos(prev => prev.filter((_, i) => i !== idx))
    setPhotoPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  function removeReport(idx: number) {
    setPendingReports(prev => prev.filter((_, i) => i !== idx))
  }

  function debouncedSearchLeads(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) { setLeads([]); setSearching(false); return }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(q)}&limit=10`)
        if (!res.ok) return
        const data = await res.json()
        setLeads(data.results ?? [])
      } finally {
        setSearching(false)
      }
    }, 400)
  }

  useEffect(() => { return () => { if (debounceRef.current) clearTimeout(debounceRef.current) } }, [])

  async function handleCreate() {
    if (!selectedLead) { setError('Please select a lead'); return }
    setError(null)
    setCreating(true)
    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: selectedLead.id,
          title: title || null,
          description: description || null,
          show_address: showAddress,
          show_arv: showArv,
          show_asking_price: showAskingPrice,
          show_assignment_fee: showAssignmentFee,
          accept_offers: acceptOffers,
          requires_registration: requiresRegistration,
          contract_close_date: contractCloseDate || null,
          earnest_money: earnestMoney ? Number(earnestMoney) : null,
          inspection_period_days: inspectionPeriodDays ? Number(inspectionPeriodDays) : null,
          financing_terms: financingTerms || null,
          repair_estimate_low: repairEstimateLow ? Number(repairEstimateLow) : null,
          repair_estimate_high: repairEstimateHigh ? Number(repairEstimateHigh) : null,
          property_condition: propertyCondition || null,
          parking: parking || null,
          contract_notes: contractNotes || null,
          assignment_fee: assignmentFee ? Number(assignmentFee) : null,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create deal page')
      }
      const { deal } = await res.json()

      // Upload photos & reports if any
      if (deal?.id && (pendingPhotos.length > 0 || pendingReports.length > 0)) {
        for (const photo of pendingPhotos) {
          const fd = new FormData()
          fd.append('file', photo)
          fd.append('deal_page_id', deal.id)
          fd.append('type', 'photo')
          await fetch('/api/deals/upload', { method: 'POST', body: fd })
        }
        for (const report of pendingReports) {
          const fd = new FormData()
          fd.append('file', report)
          fd.append('deal_page_id', deal.id)
          fd.append('type', 'inspection_report')
          await fetch('/api/deals/upload', { method: 'POST', body: fd })
        }
      }

      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create deal page')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Create Deal Page</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
            <Icon name="close" size="text-lg" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Lead Search */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Select Lead *</label>
            <div className="relative">
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={leadSearch}
                onChange={e => { setLeadSearch(e.target.value); debouncedSearchLeads(e.target.value) }}
                placeholder="Search by address or name..."
              />
              {searching && (
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            {leads.length > 0 && (
              <div className="mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {leads.map(lead => (
                  <button
                    key={lead.id}
                    onClick={() => {
                      setSelectedLead(lead)
                      setLeads([])
                      setLeadSearch(lead.property_address ?? lead.id)
                      setTitle(lead.property_address ?? '')
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0"
                  >
                    <p className="font-medium text-slate-900">{lead.property_address ?? 'Unknown address'}</p>
                    <p className="text-xs text-slate-500">{lead.full_name ?? ''}</p>
                  </button>
                ))}
              </div>
            )}
            {selectedLead && (
              <div className="mt-2 flex items-center gap-2 bg-primary/10 text-primary text-xs font-semibold rounded-lg px-3 py-2">
                <Icon name="check_circle" size="text-sm" />
                {selectedLead.property_address}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Page Title</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Great deal in 64112..."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the deal..."
            />
          </div>

          {/* Photo Upload */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Photos</label>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handlePhotoFiles(e.dataTransfer.files) }}
              onClick={() => photoInputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors',
                dragOver ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-slate-300'
              )}
            >
              <Icon name="add_photo_alternate" className="text-2xl text-slate-400 mb-1" />
              <p className="text-xs text-slate-500">Drop photos here or click to browse</p>
              <p className="text-[10px] text-slate-400 mt-0.5">JPG, PNG, WebP up to 10MB</p>
              <input
                ref={photoInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={e => handlePhotoFiles(e.target.files)}
              />
            </div>
            {photoPreviews.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mt-2">
                {photoPreviews.map((src, i) => (
                  <div key={i} className="relative group">
                    <img src={src} alt="" className="w-full h-16 object-cover rounded-lg" />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inspection Reports */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Inspection Reports (PDF)</label>
            <button
              type="button"
              onClick={() => reportInputRef.current?.click()}
              className="w-full border border-dashed border-slate-200 hover:border-slate-300 rounded-lg p-3 text-center transition-colors"
            >
              <Icon name="upload_file" className="text-xl text-slate-400 mb-0.5" />
              <p className="text-xs text-slate-500">Click to upload PDF reports</p>
              <input
                ref={reportInputRef}
                type="file"
                multiple
                accept="application/pdf"
                className="hidden"
                onChange={e => handleReportFiles(e.target.files)}
              />
            </button>
            {pendingReports.length > 0 && (
              <div className="mt-2 space-y-1">
                {pendingReports.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 text-xs">
                    <Icon name="description" size="text-sm" className="text-red-400" />
                    <span className="flex-1 truncate text-slate-700">{f.name}</span>
                    <button type="button" onClick={() => removeReport(i)} className="text-slate-400 hover:text-red-500">&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Contract Terms */}
          <div>
            <p className="text-xs font-bold text-slate-600 mb-2">Contract Terms</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Close Date</label>
                <input type="date" value={contractCloseDate} onChange={e => setContractCloseDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Earnest Money ($)</label>
                <input type="number" value={earnestMoney} onChange={e => setEarnestMoney(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="5000" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Inspection Period (days)</label>
                <input type="number" value={inspectionPeriodDays} onChange={e => setInspectionPeriodDays(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="10" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Financing Terms</label>
                <input type="text" value={financingTerms} onChange={e => setFinancingTerms(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Cash, seller financing..." />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Assignment Fee ($)</label>
                <input type="number" value={assignmentFee} onChange={e => setAssignmentFee(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="10000" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Property Condition</label>
                <select value={propertyCondition} onChange={e => setPropertyCondition(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">Select...</option>
                  <option value="Excellent">Excellent</option>
                  <option value="Good">Good</option>
                  <option value="Fair">Fair</option>
                  <option value="Poor">Poor</option>
                  <option value="Needs Full Rehab">Needs Full Rehab</option>
                  <option value="Teardown">Teardown</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Parking</label>
                <input type="text" value={parking} onChange={e => setParking(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="2 car garage" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Repair Est. Low ($)</label>
                <input type="number" value={repairEstimateLow} onChange={e => setRepairEstimateLow(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="15000" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Repair Est. High ($)</label>
                <input type="number" value={repairEstimateHigh} onChange={e => setRepairEstimateHigh(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="30000" />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-[10px] text-slate-500 mb-0.5">Contract Notes</label>
              <textarea rows={2} value={contractNotes} onChange={e => setContractNotes(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                placeholder="Any notes about the contract..." />
            </div>
          </div>

          {/* Visibility toggles */}
          <div>
            <p className="text-xs font-bold text-slate-600 mb-2">Show on Page</p>
            <div className="space-y-2">
              {[
                { label: 'Property Address', val: showAddress, set: setShowAddress },
                { label: 'ARV', val: showArv, set: setShowArv },
                { label: 'Asking Price', val: showAskingPrice, set: setShowAskingPrice },
                { label: 'Assignment Fee', val: showAssignmentFee, set: setShowAssignmentFee },
                { label: 'Accept Offers', val: acceptOffers, set: setAcceptOffers },
                { label: 'Require Registration to View', val: requiresRegistration, set: setRequiresRegistration },
              ].map(({ label, val, set }) => (
                <label key={label} className="flex items-center gap-3 cursor-pointer">
                  <div
                    onClick={() => set(!val)}
                    className={cn(
                      'relative w-9 h-5 rounded-full transition-colors cursor-pointer',
                      val ? 'bg-[#E32E2E]' : 'bg-slate-200'
                    )}
                  >
                    <span className={cn(
                      'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform',
                      val ? 'translate-x-4' : 'translate-x-0'
                    )} />
                  </div>
                  <span className="text-sm text-slate-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2 pb-1">
            <button
              onClick={onClose}
              className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !selectedLead}
              className="flex-1 bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Create Page'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Deal Page Card
// ---------------------------------------------------------------------------
function DealPageCard({ page, onToggle, onCopied, onEdit }: {
  page: DealPage & { property_address?: string }
  onToggle: (id: string, active: boolean) => void
  onCopied: () => void
  onEdit: (page: DealPage) => void
}) {
  const url = getDealPageUrl(page.slug)

  function copyLink() {
    navigator.clipboard.writeText(url).catch(() => {})
    onCopied()
  }

  return (
    <div className={cn(
      'bg-white rounded-xl border shadow-sm overflow-hidden transition-all',
      page.is_active ? 'border-slate-100' : 'border-slate-100 opacity-70'
    )}>
      {/* Card header */}
      <div className={cn(
        'h-2 w-full',
        page.is_active ? 'bg-emerald-400' : 'bg-slate-200'
      )} />

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 truncate text-sm">
              {page.title ?? (page as DealPage & { property_address?: string }).property_address ?? `Deal Page`}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{url}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer flex-shrink-0" title={page.is_active ? 'Active' : 'Inactive'}>
            <input
              type="checkbox"
              className="sr-only peer"
              checked={page.is_active}
              onChange={() => onToggle(page.id, !page.is_active)}
            />
            <div className="w-9 h-5 bg-slate-200 peer-checked:bg-emerald-500 rounded-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4 transition-colors" />
          </label>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="text-center bg-slate-50 rounded-lg py-2">
            <p className="text-lg font-bold text-slate-900">{page.view_count}</p>
            <p className="text-[10px] text-slate-500">Views</p>
          </div>
          <div className="text-center bg-slate-50 rounded-lg py-2">
            <p className="text-lg font-bold text-slate-900">{page.unique_visitors}</p>
            <p className="text-[10px] text-slate-500">Visitors</p>
          </div>
          <div className="text-center bg-slate-50 rounded-lg py-2">
            <p className="text-lg font-bold text-slate-900">—</p>
            <p className="text-[10px] text-slate-500">Offers</p>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1 mb-4">
          {page.accept_offers && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#E32E2E]/20 text-[#f87171]">Accepts Offers</span>
          )}
          {page.requires_registration && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300">Reg Required</span>
          )}
          {page.show_arv && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">ARV Shown</span>
          )}
        </div>

        <p className="text-[11px] text-slate-400 mb-3">Created {formatDate(page.created_at)}</p>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => onEdit(page)}
            className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <Icon name="edit" size="text-xs" />
            Edit
          </button>
          <button
            onClick={copyLink}
            className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <Icon name="content_copy" size="text-xs" />
            Copy
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
            onClick={e => e.stopPropagation()}
          >
            <Icon name="open_in_new" size="text-xs" />
            View
          </a>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit Deal Page Modal
// ---------------------------------------------------------------------------
function EditDealPageModal({ deal, onClose, onSaved }: { deal: DealPage; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: deal.title || '',
    description: deal.description || '',
    contract_close_date: deal.contract_close_date || '',
    earnest_money: deal.earnest_money != null ? String(deal.earnest_money) : '',
    inspection_period_days: deal.inspection_period_days != null ? String(deal.inspection_period_days) : '',
    financing_terms: deal.financing_terms || '',
    repair_estimate_low: deal.repair_estimate_low != null ? String(deal.repair_estimate_low) : '',
    repair_estimate_high: deal.repair_estimate_high != null ? String(deal.repair_estimate_high) : '',
    property_condition: deal.property_condition || '',
    parking: deal.parking || '',
    contract_notes: deal.contract_notes || '',
    assignment_fee: deal.assignment_fee != null ? String(deal.assignment_fee) : '',
    show_address: deal.show_address,
    show_arv: deal.show_arv,
    show_asking_price: deal.show_asking_price,
    show_assignment_fee: deal.show_assignment_fee,
    accept_offers: deal.accept_offers,
  })
  const [importingPhotos, setImportingPhotos] = useState(false)
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoImportStatus, setPhotoImportStatus] = useState<string | null>(null)
  const [uploadingReport, setUploadingReport] = useState(false)
  const [photos, setPhotos] = useState<string[]>(deal.photos || [])
  const [reports, setReports] = useState<InspectionReport[]>(deal.inspection_reports || [])
  const reportRef = useRef<HTMLInputElement | null>(null)

  function set(key: string, value: string | boolean) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function importPhotoUrls() {
    const raw = photoUrl.trim()
    if (!raw) return
    // Support comma/newline/space separated URLs
    const urls = raw.split(/[\s,\n]+/).filter(u => u.startsWith('http'))
    if (urls.length === 0) { setPhotoImportStatus('No valid URLs found'); return }
    setImportingPhotos(true)
    setPhotoImportStatus(`Importing ${urls.length} photo${urls.length > 1 ? 's' : ''}...`)
    try {
      const res = await fetch('/api/deals/import-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_page_id: deal.id, urls }),
      })
      if (!res.ok) {
        const data = await res.json()
        setPhotoImportStatus(`Error: ${data.error || 'Import failed'}`)
        return
      }
      const data = await res.json()
      // Refresh photos from server
      const dpRes = await fetch(`/api/deals/${deal.id}`)
      if (dpRes.ok) {
        const dp = await dpRes.json()
        if (dp.photos) setPhotos(dp.photos)
      }
      setPhotoUrl('')
      setPhotoImportStatus(`Imported ${data.imported} photo${data.imported !== 1 ? 's' : ''}${data.failed ? `, ${data.failed} failed` : ''}`)
      setTimeout(() => setPhotoImportStatus(null), 4000)
    } catch {
      setPhotoImportStatus('Import failed — check the URL')
    } finally {
      setImportingPhotos(false)
    }
  }

  async function uploadReport(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploadingReport(true)
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('deal_page_id', deal.id)
      fd.append('type', 'inspection_report')
      const res = await fetch('/api/deals/upload', { method: 'POST', body: fd })
      if (res.ok) {
        const { url } = await res.json()
        setReports(prev => [...prev, { name: file.name, url, uploaded_at: new Date().toISOString() }])
      }
    }
    setUploadingReport(false)
  }

  async function handleSave() {
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title || null,
          description: form.description || null,
          contract_close_date: form.contract_close_date || null,
          earnest_money: form.earnest_money ? Number(form.earnest_money) : null,
          inspection_period_days: form.inspection_period_days ? Number(form.inspection_period_days) : null,
          financing_terms: form.financing_terms || null,
          repair_estimate_low: form.repair_estimate_low ? Number(form.repair_estimate_low) : null,
          repair_estimate_high: form.repair_estimate_high ? Number(form.repair_estimate_high) : null,
          property_condition: form.property_condition || null,
          parking: form.parking || null,
          contract_notes: form.contract_notes || null,
          assignment_fee: form.assignment_fee ? Number(form.assignment_fee) : null,
          photos,
          inspection_reports: reports,
          show_address: form.show_address,
          show_arv: form.show_arv,
          show_asking_price: form.show_asking_price,
          show_assignment_fee: form.show_assignment_fee,
          accept_offers: form.accept_offers,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save')
      }
      onSaved()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Edit Deal Page</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
            <Icon name="close" size="text-lg" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{err}</div>}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Title</label>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
            <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
          </div>

          {/* Photos — import via URL, drag to reorder */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Photos ({photos.length}) {photos.length > 0 && <span className="font-normal text-slate-400">— drag to reorder, first = cover</span>}
            </label>
            {photos.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mb-2">
                {photos.map((url, i) => (
                  <div
                    key={url}
                    draggable
                    onDragStart={e => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move' }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                    onDrop={e => {
                      e.preventDefault()
                      const from = Number(e.dataTransfer.getData('text/plain'))
                      if (from === i) return
                      setPhotos(prev => {
                        const arr = [...prev]
                        const [moved] = arr.splice(from, 1)
                        arr.splice(i, 0, moved)
                        return arr
                      })
                    }}
                    className={cn(
                      'relative group cursor-grab active:cursor-grabbing rounded-lg overflow-hidden',
                      i === 0 ? 'ring-2 ring-teal-500' : '',
                      i < 5 && i > 0 ? 'ring-1 ring-blue-200' : ''
                    )}
                  >
                    <img src={url} alt="" className="w-full h-16 object-cover" />
                    {i === 0 && (
                      <span className="absolute bottom-0 left-0 right-0 bg-teal-600/90 text-white text-[9px] font-bold text-center py-0.5">COVER</span>
                    )}
                    {i >= 1 && i <= 4 && (
                      <span className="absolute bottom-0 left-0 right-0 bg-blue-600/70 text-white text-[9px] text-center py-0.5">#{i + 1}</span>
                    )}
                    <button type="button"
                      onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    >&times;</button>
                  </div>
                ))}
              </div>
            )}
            {/* URL import input */}
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={photoUrl}
                onChange={e => setPhotoUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); importPhotoUrls() } }}
                placeholder="Paste image URL(s) — comma or space separated"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                disabled={importingPhotos}
              />
              <button
                type="button"
                onClick={importPhotoUrls}
                disabled={importingPhotos || !photoUrl.trim()}
                className="bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap"
              >
                {importingPhotos ? 'Importing...' : 'Import'}
              </button>
            </div>
            {photoImportStatus && (
              <p className={cn('text-xs mt-1', photoImportStatus.startsWith('Error') ? 'text-red-500' : 'text-green-600')}>{photoImportStatus}</p>
            )}
          </div>

          {/* Inspection Reports */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Inspection Reports ({reports.length})</label>
            {reports.length > 0 && (
              <div className="space-y-1 mb-2">
                {reports.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 text-xs">
                    <Icon name="description" size="text-sm" className="text-red-400" />
                    <span className="flex-1 truncate text-slate-700">{r.name}</span>
                    <button type="button" onClick={() => setReports(prev => prev.filter((_, j) => j !== i))}
                      className="text-slate-400 hover:text-red-500">&times;</button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={() => reportRef.current?.click()}
              className="text-xs text-primary hover:underline font-semibold">
              {uploadingReport ? 'Uploading...' : '+ Add Report'}
            </button>
            <input ref={reportRef} type="file" accept="application/pdf" className="hidden"
              onChange={e => uploadReport(e.target.files)} />
          </div>

          {/* Contract Terms */}
          <div>
            <p className="text-xs font-bold text-slate-600 mb-2">Contract Terms</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Close Date</label>
                <input type="date" value={form.contract_close_date} onChange={e => set('contract_close_date', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Earnest Money ($)</label>
                <input type="number" value={form.earnest_money} onChange={e => set('earnest_money', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Inspection (days)</label>
                <input type="number" value={form.inspection_period_days} onChange={e => set('inspection_period_days', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Financing</label>
                <input type="text" value={form.financing_terms} onChange={e => set('financing_terms', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Assignment Fee ($)</label>
                <input type="number" value={form.assignment_fee} onChange={e => set('assignment_fee', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Condition</label>
                <select value={form.property_condition} onChange={e => set('property_condition', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">Select...</option>
                  <option value="Excellent">Excellent</option>
                  <option value="Good">Good</option>
                  <option value="Fair">Fair</option>
                  <option value="Poor">Poor</option>
                  <option value="Needs Full Rehab">Needs Full Rehab</option>
                  <option value="Teardown">Teardown</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Parking</label>
                <input type="text" value={form.parking} onChange={e => set('parking', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Repair Est. Low ($)</label>
                <input type="number" value={form.repair_estimate_low} onChange={e => set('repair_estimate_low', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Repair Est. High ($)</label>
                <input type="number" value={form.repair_estimate_high} onChange={e => set('repair_estimate_high', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-[10px] text-slate-500 mb-0.5">Contract Notes</label>
              <textarea rows={2} value={form.contract_notes} onChange={e => set('contract_notes', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
            </div>
          </div>

          {/* Visibility Toggles */}
          <div>
            <p className="text-xs font-bold text-slate-600 mb-2">Show on Page</p>
            <div className="space-y-2">
              {([
                ['show_address', 'Property Address'],
                ['show_arv', 'ARV'],
                ['show_asking_price', 'Asking Price'],
                ['show_assignment_fee', 'Assignment Fee'],
                ['accept_offers', 'Accept Offers'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <div
                    onClick={() => set(key, !form[key])}
                    className={cn(
                      'relative w-9 h-5 rounded-full transition-colors cursor-pointer',
                      form[key] ? 'bg-[#E32E2E]' : 'bg-slate-200'
                    )}
                  >
                    <span className={cn(
                      'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform',
                      form[key] ? 'translate-x-4' : 'translate-x-0'
                    )} />
                  </div>
                  <span className="text-sm text-slate-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2 pb-1">
            <button onClick={onClose}
              className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60">
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
export default function DealPagesPage() {
  const [pages, setPages] = useState<(DealPage & { property_address?: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingDeal, setEditingDeal] = useState<DealPage | null>(null)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchPages() {
    setLoading(true)
    try {
      const res = await fetch('/api/deals')
      if (!res.ok) throw new Error('Failed to fetch deal pages')
      const data = await res.json()
      setPages(data.pages ?? [])
    } catch {
      setError('Failed to load deal pages')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchPages() }, [])

  async function handleToggle(id: string, active: boolean) {
    try {
      const res = await fetch(`/api/deals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: active }),
      })
      if (!res.ok) return
      setPages(prev => prev.map(p => p.id === id ? { ...p, is_active: active } : p))
    } catch {
      // silently ignore
    }
  }

  function handleCopied() {
    setCopyFeedback(true)
    setTimeout(() => setCopyFeedback(false), 2000)
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-6 pb-32 max-w-[1440px] mx-auto">
      {showCreate && (
        <CreateDealPageModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchPages() }}
        />
      )}

      {editingDeal && (
        <EditDealPageModal
          deal={editingDeal}
          onClose={() => setEditingDeal(null)}
          onSaved={() => { setEditingDeal(null); fetchPages() }}
        />
      )}

      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Deal Pages</h1>
          <p className="text-slate-500 text-sm">
            {loading ? 'Loading…' : `${pages.length} deal page${pages.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[#E32E2E] text-white hover:bg-[#C42626] rounded-lg px-4 py-2 text-sm font-semibold self-start sm:self-auto"
        >
          <Icon name="add" size="text-sm" />
          Create Deal Page
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="text-slate-400 py-16 text-center">Loading deal pages...</div>
      ) : pages.length === 0 ? (
        <div className="text-center py-20">
          <Icon name="web" className="text-5xl text-slate-200 mb-4" />
          <p className="text-slate-400 font-medium text-lg">No deal pages yet</p>
          <p className="text-slate-400 text-sm mt-1 mb-6 max-w-sm mx-auto">
            Create one from a lead in disposition stage. Share the link with buyers to collect offers.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary text-white hover:bg-primary/90 rounded-lg px-5 py-2.5 text-sm font-semibold"
          >
            Create First Deal Page
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {pages.map(page => (
            <DealPageCard
              key={page.id}
              page={page}
              onToggle={handleToggle}
              onCopied={handleCopied}
              onEdit={setEditingDeal}
            />
          ))}
        </div>
      )}

      {/* Copy feedback toast */}
      {copyFeedback && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-xl flex items-center gap-2">
          <Icon name="check_circle" size="text-sm" className="text-emerald-400" />
          Link copied to clipboard
        </div>
      )}
    </div>
  )
}
