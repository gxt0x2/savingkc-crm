'use client'

import { useState, useEffect, useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { DealPage, InspectionReport } from '@/types/dispo'
import { DealStatsPanel } from '@/components/deals/deal-stats-panel'

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

// ---------------------------------------------------------------------------
// Constants for dropdowns
// ---------------------------------------------------------------------------
const PROPERTY_TYPES = [
  'Attached', 'Commercial', 'Condo', 'Detached', 'Development', 'Industrial',
  'Land', 'Manufactured', 'Mobile Home', 'Multifamily', 'Office', 'Recreational',
  'Semi-detached', 'Single-Family', 'Storage', 'Townhouse',
]
const PARKING_TYPES = [
  'Driveway', 'Garage', 'Off street', 'On street', 'Attached Garage',
  'Unassigned', 'Street', 'Detached Garage', 'Assigned', 'Carport',
]
const REHAB_SCOPES = ['Full Rehab', 'Major Repair', 'Light Rehab', 'Turn Key']
const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
  'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
  'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
  'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire',
  'New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio',
  'Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota',
  'Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia',
  'Wisconsin','Wyoming',
]
const STEP_LABELS = ['Lead', 'Description', 'Value', 'Price', 'Info', 'Address', 'Terms', 'Photos']
const TOTAL_STEPS = STEP_LABELS.length

// Shared input class
const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30'
const selectCls = inputCls + ' appearance-none bg-white'
const labelCls = 'block text-sm font-semibold text-slate-700 mb-1'

interface ManifestData {
  property?: {
    condition?: string | null
    occupancy?: string | null
    known_issues?: string[] | null
    bedrooms?: number | null
    bathrooms?: number | null
    sqft?: number | null
    year_built?: number | null
    lot_size_sqft?: number | null
    property_type?: string | null
  }
  financials?: {
    estimated_arv?: number | null
    estimated_repair_cost?: number | null
    estimated_spread?: number | null
    seller_asking_price?: number | null
    seller_floor_price?: number | null
    our_max_offer?: number | null
    mortgage_balance?: number | null
    back_taxes_owed?: number | null
    liens_total?: number | null
  }
  situation?: {
    life_event_type?: string | null
    timeline_raw?: string | null
    opportunity_flags?: { label: string; notes?: string | null }[] | null
  }
  motivation?: {
    score?: number | null
    primary_driver?: string | null
    urgency_signals?: string[] | null
  }
}

interface FullLead {
  id: string
  full_name: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  property_type: string | null
  beds: number | null
  baths_full: number | null
  baths_half: number | null
  sqft: number | null
  lot_size: number | null
  year_built: number | null
  arv: number | null
  offer_amount: number | null
  repair_estimate: number | null
  assignment_fee: number | null
  garage_spaces: number | null
  basement_type: string | null
  stories: number | null
  last_sale_price: number | null
  tax_assessment: number | null
  manifest: ManifestData | null
}

function buildAutoTitle(d: FullLead): string {
  const parts: string[] = []
  if (d.beds) parts.push(`${d.beds}BR`)
  if (d.baths_full) parts.push(`${d.baths_full}BA`)
  const type = d.property_type || 'Home'
  const loc = d.city || ''
  const bedBath = parts.length > 0 ? `${parts.join('/')} ${type}` : type

  // Calculate discount off ARV for headline
  const arv = d.arv || d.manifest?.financials?.estimated_arv
  const sellPrice = arv ? Math.round(arv * 0.75) : null
  let discount = ''
  if (arv && sellPrice && sellPrice < arv) {
    const pct = Math.round(((arv - sellPrice) / arv) * 100)
    if (pct >= 10) discount = `${pct}% Below Market `
  }

  // Determine rehab indicator
  const repairCost = d.repair_estimate || d.manifest?.financials?.estimated_repair_cost
  let rehabTag = ''
  if (repairCost) {
    if (repairCost <= 15000) rehabTag = ' | Light Rehab'
    else if (repairCost <= 40000) rehabTag = ' | Value-Add'
    else rehabTag = ' | Major Upside'
  }

  if (loc) return `${discount}${bedBath} in ${loc}${rehabTag}`
  return d.property_address ? `${discount}${bedBath} — ${d.property_address}${rehabTag}` : `Investment Opportunity — ${bedBath}`
}

function buildAutoDescription(d: FullLead): string {
  const m = d.manifest
  const lines: string[] = []
  const type = d.property_type || 'property'
  const addr = d.property_address || 'this property'
  const arv = d.arv || m?.financials?.estimated_arv

  // Hook line for cash buyers
  if (arv) {
    lines.push(`Cash buyer opportunity — ${type.toLowerCase()} at ${addr} with $${arv.toLocaleString()} ARV.\n`)
  } else {
    lines.push(`Cash buyer opportunity — ${type.toLowerCase()} at ${addr}.\n`)
  }

  // Property highlights
  const highlights: string[] = []
  if (d.beds && d.baths_full) highlights.push(`${d.beds} bed / ${d.baths_full} bath${d.baths_half ? ` + ${d.baths_half} half` : ''}`)
  if (d.sqft) highlights.push(`${d.sqft.toLocaleString()} sq ft`)
  if (d.lot_size) highlights.push(`${d.lot_size} acre lot`)
  if (d.year_built) highlights.push(`Built ${d.year_built}`)
  if (d.garage_spaces && d.garage_spaces > 0) highlights.push(`${d.garage_spaces}-car garage`)
  if (d.basement_type && d.basement_type !== 'None') highlights.push(`${d.basement_type} basement`)
  if (d.stories) highlights.push(`${d.stories} ${d.stories === 1 ? 'story' : 'stories'}`)
  if (highlights.length > 0) {
    lines.push('PROPERTY HIGHLIGHTS:')
    highlights.forEach(h => lines.push(`- ${h}`))
    lines.push('')
  }

  // Financial highlights
  const finHighlights: string[] = []
  if (arv) finHighlights.push(`ARV: $${arv.toLocaleString()}`)
  const repairCost = d.repair_estimate || m?.financials?.estimated_repair_cost
  if (repairCost) finHighlights.push(`Est. Repairs: $${repairCost.toLocaleString()}`)
  const spread = m?.financials?.estimated_spread
  if (spread && spread > 0) finHighlights.push(`Estimated Spread: $${spread.toLocaleString()}`)
  if (finHighlights.length > 0) {
    lines.push('DEAL NUMBERS:')
    finHighlights.forEach(h => lines.push(`- ${h}`))
    lines.push('')
  }

  // Situation / opportunity from manifest
  const condition = m?.property?.condition
  if (condition && condition !== 'unknown') {
    lines.push(`CONDITION: ${condition.charAt(0).toUpperCase() + condition.slice(1)}`)
  }
  const occupancy = m?.property?.occupancy
  if (occupancy && occupancy !== 'unknown') {
    const label = occupancy.replace(/_/g, ' ')
    lines.push(`OCCUPANCY: ${label.charAt(0).toUpperCase() + label.slice(1)}`)
  }
  const knownIssues = m?.property?.known_issues
  if (knownIssues && knownIssues.length > 0) {
    lines.push('\nKNOWN ITEMS:')
    knownIssues.forEach(issue => lines.push(`- ${issue}`))
  }
  const flags = m?.situation?.opportunity_flags
  if (flags && flags.length > 0) {
    lines.push('\nOPPORTUNITY:')
    flags.forEach(f => lines.push(`- ${f.label}${f.notes ? `: ${f.notes}` : ''}`))
  }

  return lines.join('\n')
}

function CreateDealPageModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState(0)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 0: Lead search
  const [leadSearch, setLeadSearch] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [fullLead, setFullLead] = useState<FullLead | null>(null)
  const [loadingLead, setLoadingLead] = useState(false)

  // Step 1: Description
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  // Step 2: Deal Value
  const [arvEstimate, setArvEstimate] = useState('')
  const [rehabScope, setRehabScope] = useState('')
  const [repairEstimateLow, setRepairEstimateLow] = useState('')
  const [repairEstimateHigh, setRepairEstimateHigh] = useState('')

  // Step 3: Deal Price
  const [askingPrice, setAskingPrice] = useState('')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [minimumEmd, setMinimumEmd] = useState('')

  // Step 4: Deal Info
  const [propertyType, setPropertyType] = useState('')
  const [parkingType, setParkingType] = useState('')
  const [bedrooms, setBedrooms] = useState('')
  const [fullBathrooms, setFullBathrooms] = useState('')
  const [halfBathrooms, setHalfBathrooms] = useState('')
  const [squareFootage, setSquareFootage] = useState('')
  const [yearBuilt, setYearBuilt] = useState('')

  // Step 5: Address
  const [streetAddress, setStreetAddress] = useState('')
  const [unit, setUnit] = useState('')
  const [city, setCity] = useState('')
  const [county, setCounty] = useState('')
  const [addrState, setAddrState] = useState('')
  const [zipCode, setZipCode] = useState('')

  // Step 4: Deal Info (extra fields)
  const [lotSize, setLotSize] = useState('')
  const [garageSpaces, setGarageSpaces] = useState('')
  const [basementType, setBasementType] = useState('')
  const [stories, setStories] = useState('')
  const [propertyCondition, setPropertyCondition] = useState('')

  // Step 6: Terms
  const [contractCloseDate, setContractCloseDate] = useState('')
  const [earnestMoney, setEarnestMoney] = useState('')
  const [inspectionDays, setInspectionDays] = useState('')
  const [financingTerms, setFinancingTerms] = useState('')
  const [postOccupancy, setPostOccupancy] = useState('')
  const [addendums, setAddendums] = useState('')
  const [amendments, setAmendments] = useState('')
  const [contractNotes, setContractNotes] = useState('')
  const [assignmentFee, setAssignmentFee] = useState('')

  // Step 7: Photos
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [photoUrls, setPhotoUrls] = useState('')
  const [pendingPhotoUrls, setPendingPhotoUrls] = useState<string[]>([])

  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)

  // Computed profit potential
  const profitPotential = (askingPrice && purchasePrice)
    ? Number(askingPrice) - Number(purchasePrice)
    : 0

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

  function removePhoto(idx: number) {
    setPendingPhotos(prev => prev.filter((_, i) => i !== idx))
    setPhotoPreviews(prev => prev.filter((_, i) => i !== idx))
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

  async function fetchFullLead(leadId: string) {
    setLoadingLead(true)
    try {
      const res = await fetch(`/api/leads/${leadId}`)
      if (!res.ok) return
      const data: FullLead = await res.json()
      setFullLead(data)
      const m = data.manifest

      // --- Pre-populate EVERYTHING possible from lead + manifest data ---

      // Step 1: Description — cash-buyer-focused title & bullet-point description
      setTitle(buildAutoTitle(data))
      setDescription(buildAutoDescription(data))

      // Step 2: Deal Value
      const arv = data.arv || m?.financials?.estimated_arv
      if (arv) setArvEstimate(String(arv))
      const repairEst = data.repair_estimate || m?.financials?.estimated_repair_cost
      if (repairEst) {
        setRepairEstimateLow(String(Math.round(repairEst * 0.7)))
        setRepairEstimateHigh(String(repairEst))
      }
      // Auto-set rehab scope from repair cost
      if (repairEst && !rehabScope) {
        if (repairEst <= 10000) setRehabScope('Turn Key')
        else if (repairEst <= 25000) setRehabScope('Light Rehab')
        else if (repairEst <= 50000) setRehabScope('Major Repair')
        else setRehabScope('Full Rehab')
      }
      // Auto-set property condition from manifest
      const mCondition = m?.property?.condition
      if (mCondition && mCondition !== 'unknown') {
        const condMap: Record<string, string> = {
          excellent: 'Excellent', good: 'Good', fair: 'Fair',
          poor: 'Poor', distressed: 'Needs Full Rehab',
        }
        if (condMap[mCondition]) setPropertyCondition(condMap[mCondition])
      }

      // Step 3: Deal Price
      if (arv) setAskingPrice(String(Math.round(arv * 0.75)))
      if (data.offer_amount) setPurchasePrice(String(data.offer_amount))
      else if (m?.financials?.our_max_offer) setPurchasePrice(String(m.financials.our_max_offer))
      const pp = data.offer_amount || m?.financials?.our_max_offer
      if (pp) setMinimumEmd(String(Math.round(pp * 0.02)))

      // Step 4: Deal Info
      if (data.property_type) setPropertyType(data.property_type)
      if (data.beds) setBedrooms(String(data.beds))
      else if (m?.property?.bedrooms) setBedrooms(String(m.property.bedrooms))
      if (data.baths_full) setFullBathrooms(String(data.baths_full))
      else if (m?.property?.bathrooms) setFullBathrooms(String(m.property.bathrooms))
      if (data.baths_half != null) setHalfBathrooms(String(data.baths_half))
      if (data.sqft) setSquareFootage(String(data.sqft))
      else if (m?.property?.sqft) setSquareFootage(String(m.property.sqft))
      if (data.year_built) setYearBuilt(String(data.year_built))
      else if (m?.property?.year_built) setYearBuilt(String(m.property.year_built))
      if (data.lot_size) setLotSize(String(data.lot_size))
      if (data.garage_spaces) setGarageSpaces(String(data.garage_spaces))
      if (data.basement_type) setBasementType(data.basement_type)
      if (data.stories) setStories(String(data.stories))
      if (data.garage_spaces && data.garage_spaces > 0 && !data.basement_type) {
        setParkingType('Garage')
      }

      // Step 5: Address
      if (data.property_address) setStreetAddress(data.property_address)
      if (data.city) setCity(data.city)
      if (data.state) setAddrState(data.state)
      if (data.zip) setZipCode(data.zip)
      if (data.county) setCounty(data.county)

      // Step 7: Terms — defaults
      if (!contractCloseDate) {
        // Default 30 days from now
        const d30 = new Date()
        d30.setDate(d30.getDate() + 30)
        setContractCloseDate(d30.toISOString().split('T')[0])
      }
      if (!inspectionDays) setInspectionDays('10')
      if (!financingTerms) setFinancingTerms('Cash — no financing contingency')
    } finally {
      setLoadingLead(false)
    }
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
          repair_estimate_low: repairEstimateLow ? Number(repairEstimateLow) : null,
          repair_estimate_high: repairEstimateHigh ? Number(repairEstimateHigh) : null,
          property_condition: propertyCondition || rehabScope || null,
          asking_price: askingPrice ? Number(askingPrice) : null,
          purchase_price: purchasePrice ? Number(purchasePrice) : null,
          earnest_money: (earnestMoney || minimumEmd) ? Number(earnestMoney || minimumEmd) : null,
          parking: parkingType || null,
          contract_close_date: contractCloseDate || null,
          inspection_period_days: inspectionDays ? Number(inspectionDays) : null,
          financing_terms: financingTerms || null,
          contract_notes: [
            postOccupancy ? `POST-OCCUPANCY: ${postOccupancy}` : '',
            addendums ? `ADDENDUMS: ${addendums}` : '',
            amendments ? `AMENDMENTS: ${amendments}` : '',
            contractNotes || '',
          ].filter(Boolean).join('\n\n') || null,
          assignment_fee: assignmentFee ? Number(assignmentFee) : null,
          accept_offers: true,
          show_address: true,
          show_arv: true,
          show_asking_price: true,
          lead_updates: {
            arv: arvEstimate ? Number(arvEstimate) : undefined,
            offer_amount: purchasePrice ? Number(purchasePrice) : undefined,
            repair_estimate: repairEstimateHigh ? Number(repairEstimateHigh) : undefined,
            beds: bedrooms ? Number(bedrooms) : undefined,
            baths_full: fullBathrooms ? Number(fullBathrooms) : undefined,
            baths_half: halfBathrooms ? Number(halfBathrooms) : undefined,
            sqft: squareFootage ? Number(squareFootage) : undefined,
            year_built: yearBuilt ? Number(yearBuilt) : undefined,
            property_type: propertyType || undefined,
            property_address: streetAddress || undefined,
            city: city || undefined,
            state: addrState || undefined,
            zip: zipCode || undefined,
            county: county || undefined,
          },
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create deal page')
      }
      const { deal } = await res.json()

      // Upload local file photos
      if (deal?.id && pendingPhotos.length > 0) {
        for (const photo of pendingPhotos) {
          const fd = new FormData()
          fd.append('file', photo)
          fd.append('deal_page_id', deal.id)
          fd.append('type', 'photo')
          const uploadRes = await fetch('/api/deals/upload', { method: 'POST', body: fd })
          if (!uploadRes.ok) {
            const uploadErr = await uploadRes.json().catch(() => ({}))
            throw new Error(uploadErr.error || `Failed to upload ${photo.name}`)
          }
        }
      }

      // Import URL-based photos (Google Photos links, etc.)
      if (deal?.id && pendingPhotoUrls.length > 0) {
        const importRes = await fetch('/api/deals/import-photos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deal_page_id: deal.id, urls: pendingPhotoUrls }),
        })
        const importData = await importRes.json().catch(() => ({}))
        if (!importRes.ok) {
          throw new Error(importData.error || 'Failed to import photo URLs')
        }
        if (!importData.imported) {
          const details = Array.isArray(importData.errors) && importData.errors.length > 0
            ? `: ${importData.errors.slice(0, 2).join('; ')}`
            : ''
          throw new Error(`No photos were imported${details}`)
        }
      }

      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create deal page')
    } finally {
      setCreating(false)
    }
  }

  function canAdvance(): boolean {
    if (step === 0) return !!selectedLead && !loadingLead
    return true
  }

  function goNext() {
    if (step < TOTAL_STEPS - 1) setStep(step + 1)
    else handleCreate()
  }

  function goBack() {
    if (step > 0) setStep(step - 1)
  }

  // ---------------------------------------------------------------------------
  // Step renderers
  // ---------------------------------------------------------------------------
  function renderStep0() {
    return (
      <>
        <h3 className="text-xl font-bold text-slate-900 text-center">Select Lead</h3>
        <p className="text-sm text-slate-500 text-center mb-2">Which property are you creating a deal for?</p>
        <div className="relative">
          <input
            className={inputCls}
            value={leadSearch}
            onChange={e => { setLeadSearch(e.target.value); debouncedSearchLeads(e.target.value) }}
            placeholder="Search by address or name..."
            autoFocus
          />
          {searching && (
            <div className="absolute inset-y-0 right-3 flex items-center">
              <div className="w-4 h-4 border-2 border-[#E32E2E] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
        {leads.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {leads.map(lead => (
              <button
                key={lead.id}
                onClick={() => {
                  setSelectedLead(lead)
                  setLeads([])
                  setLeadSearch(lead.property_address ?? lead.id)
                  fetchFullLead(lead.id)
                }}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0"
              >
                <p className="font-medium text-slate-900">{lead.property_address ?? 'Unknown address'}</p>
                <p className="text-xs text-slate-500">{lead.full_name ?? ''}</p>
              </button>
            ))}
          </div>
        )}
        {selectedLead && (
          <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-semibold rounded-lg px-3 py-2.5">
            <Icon name="check_circle" size="text-base" />
            {selectedLead.property_address}
            {loadingLead && <span className="text-xs text-slate-500 ml-auto">Loading details...</span>}
          </div>
        )}
      </>
    )
  }

  function renderStep1() {
    const hasPrefill = !!fullLead
    return (
      <>
        <h3 className="text-xl font-bold text-slate-900 text-center">Enter Deal Description</h3>
        <p className="text-sm text-slate-500 text-center mb-2">
          {hasPrefill ? 'Auto-generated from property data. Edit as needed.' : 'What makes your deal a great investment?'}
        </p>
        <div>
          <label className={labelCls}>Deal Title</label>
          <input
            className={inputCls}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Beautiful 3BR/2BA Family Home"
            autoFocus
          />
        </div>
        <div>
          <label className={labelCls}>Deal Description</label>
          <textarea
            className={inputCls + ' resize-y min-h-[120px]'}
            rows={5}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g., quick and easy flip, cash flowing rental, great curb appeal..."
          />
        </div>
      </>
    )
  }

  function renderStep2() {
    const isNonTurnKey = rehabScope && rehabScope !== 'Turn Key'
    return (
      <>
        <h3 className="text-xl font-bold text-slate-900 text-center">Deal Value</h3>
        <div>
          <label className={labelCls}>ARV Estimate</label>
          <input
            type="number"
            className={inputCls}
            value={arvEstimate}
            onChange={e => setArvEstimate(e.target.value)}
            placeholder="e.g. $250,000"
            autoFocus
          />
        </div>
        <div>
          <label className={labelCls}>Rehab Scope</label>
          <select
            className={selectCls}
            value={rehabScope}
            onChange={e => setRehabScope(e.target.value)}
          >
            <option value="">Select Rehab Scope...</option>
            {REHAB_SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Repair Estimate (Low End)</label>
          <input
            type="number"
            className={inputCls}
            value={repairEstimateLow}
            onChange={e => setRepairEstimateLow(e.target.value)}
            placeholder="e.g. $15,000"
          />
          {isNonTurnKey && !repairEstimateLow && (
            <p className="text-xs text-red-500 mt-1">Repair estimate is required for non-turnkey deals</p>
          )}
        </div>
        <div>
          <label className={labelCls}>Repair Estimate (High End)</label>
          <input
            type="number"
            className={inputCls}
            value={repairEstimateHigh}
            onChange={e => setRepairEstimateHigh(e.target.value)}
            placeholder="e.g. $25,000"
          />
          {isNonTurnKey && !repairEstimateHigh && (
            <p className="text-xs text-red-500 mt-1">Repair estimate is required for non-turnkey deals</p>
          )}
        </div>
      </>
    )
  }

  function renderStep3() {
    return (
      <>
        <h3 className="text-xl font-bold text-slate-900 text-center">Deal Price</h3>
        <p className="text-sm text-slate-500 text-center mb-2">Let&apos;s calculate how much you could earn.</p>
        <div>
          <label className={labelCls}>How much do you want to sell it for?</label>
          <input
            type="number"
            className={inputCls}
            value={askingPrice}
            onChange={e => setAskingPrice(e.target.value)}
            placeholder="e.g. $250,000"
            autoFocus
          />
        </div>
        <div>
          <label className={labelCls}>What&apos;s your purchase price?</label>
          <input
            type="number"
            className={inputCls}
            value={purchasePrice}
            onChange={e => setPurchasePrice(e.target.value)}
            placeholder="e.g. $200,000"
          />
          <p className="text-xs text-slate-500 mt-1">Buyers will NOT see your purchase price</p>
        </div>
        <div>
          <label className={labelCls}>Minimum EMD</label>
          <input
            type="number"
            className={inputCls}
            value={minimumEmd}
            onChange={e => setMinimumEmd(e.target.value)}
            placeholder="e.g. $10,000"
          />
        </div>
        <div className="pt-2">
          <p className="text-base font-semibold text-slate-900">
            Profit Potential:{' '}
            <span className={profitPotential > 0 ? 'text-emerald-600' : profitPotential < 0 ? 'text-red-500' : 'text-slate-900'}>
              ${profitPotential.toLocaleString()}
            </span>
          </p>
        </div>
      </>
    )
  }

  function renderStep4() {
    return (
      <>
        <h3 className="text-xl font-bold text-slate-900 text-center">Deal Info</h3>
        <p className="text-sm text-slate-500 text-center mb-2">Verify the property details are accurate.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={labelCls}>Property Type</label>
            <select className={selectCls} value={propertyType} onChange={e => setPropertyType(e.target.value)}>
              <option value="">Select Property Type...</option>
              {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Parking Type</label>
            <select className={selectCls} value={parkingType} onChange={e => setParkingType(e.target.value)}>
              <option value="">Select Parking Type...</option>
              {PARKING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Bedrooms</label>
            <input type="number" className={inputCls} value={bedrooms} onChange={e => setBedrooms(e.target.value)} placeholder="e.g. 3" />
          </div>
          <div>
            <label className={labelCls}>Full Bathrooms</label>
            <input type="number" className={inputCls} value={fullBathrooms} onChange={e => setFullBathrooms(e.target.value)} placeholder="e.g. 2" />
          </div>
          <div>
            <label className={labelCls}>Half Bathrooms</label>
            <input type="number" className={inputCls} value={halfBathrooms} onChange={e => setHalfBathrooms(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className={labelCls}>Square Footage</label>
            <input type="number" className={inputCls} value={squareFootage} onChange={e => setSquareFootage(e.target.value)} placeholder="e.g. 1800" />
          </div>
          <div>
            <label className={labelCls}>Year Built</label>
            <input type="number" className={inputCls} value={yearBuilt} onChange={e => setYearBuilt(e.target.value)} placeholder="e.g. 1990" />
          </div>
          <div>
            <label className={labelCls}>Lot Size (acres)</label>
            <input type="number" step="0.01" className={inputCls} value={lotSize} onChange={e => setLotSize(e.target.value)} placeholder="e.g. 0.25" />
          </div>
          <div>
            <label className={labelCls}>Garage Spaces</label>
            <input type="number" className={inputCls} value={garageSpaces} onChange={e => setGarageSpaces(e.target.value)} placeholder="e.g. 2" />
          </div>
          <div>
            <label className={labelCls}>Stories</label>
            <input type="number" step="0.5" className={inputCls} value={stories} onChange={e => setStories(e.target.value)} placeholder="e.g. 2" />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Basement</label>
            <select className={selectCls} value={basementType} onChange={e => setBasementType(e.target.value)}>
              <option value="">None</option>
              <option value="Full">Full</option>
              <option value="Partial">Partial</option>
              <option value="Finished">Finished</option>
              <option value="Unfinished">Unfinished</option>
              <option value="Walkout">Walkout</option>
            </select>
          </div>
        </div>
      </>
    )
  }

  function renderStep5() {
    return (
      <>
        <h3 className="text-xl font-bold text-slate-900 text-center">Deal Address</h3>
        <p className="text-sm text-slate-500 text-center mb-2">Confirm the property address.</p>
        <div>
          <label className={labelCls}>Street Address</label>
          <input className={inputCls} value={streetAddress} onChange={e => setStreetAddress(e.target.value)} placeholder="123 Main St" autoFocus />
        </div>
        <div>
          <label className={labelCls}>Unit</label>
          <input className={inputCls} value={unit} onChange={e => setUnit(e.target.value)} placeholder="A, 101, etc." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>City</label>
            <input className={inputCls} value={city} onChange={e => setCity(e.target.value)} placeholder="Kansas City" />
          </div>
          <div>
            <label className={labelCls}>County</label>
            <input className={inputCls} value={county} onChange={e => setCounty(e.target.value)} placeholder="Jackson County" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>State</label>
            <select className={selectCls} value={addrState} onChange={e => setAddrState(e.target.value)}>
              <option value="">Select State...</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>ZIP Code</label>
            <input className={inputCls} value={zipCode} onChange={e => setZipCode(e.target.value)} placeholder="64112" />
          </div>
        </div>
      </>
    )
  }

  function renderStep6Terms() {
    return (
      <>
        <h3 className="text-xl font-bold text-slate-900 text-center">Terms & Conditions</h3>
        <p className="text-sm text-slate-500 text-center mb-2">Contract terms, addendums, and special conditions.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Contract Close Date</label>
            <input type="date" className={inputCls} value={contractCloseDate} onChange={e => setContractCloseDate(e.target.value)} autoFocus />
          </div>
          <div>
            <label className={labelCls}>Earnest Money ($)</label>
            <input type="number" className={inputCls} value={earnestMoney || minimumEmd} onChange={e => setEarnestMoney(e.target.value)} placeholder="e.g. 5000" />
          </div>
          <div>
            <label className={labelCls}>Inspection Period (days)</label>
            <input type="number" className={inputCls} value={inspectionDays} onChange={e => setInspectionDays(e.target.value)} placeholder="e.g. 10" />
          </div>
          <div>
            <label className={labelCls}>Assignment Fee ($)</label>
            <input type="number" className={inputCls} value={assignmentFee} onChange={e => setAssignmentFee(e.target.value)} placeholder="e.g. 10000" />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Financing Terms</label>
            <input className={inputCls} value={financingTerms} onChange={e => setFinancingTerms(e.target.value)} placeholder="Cash — no financing contingency" />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Property Condition</label>
            <select className={selectCls} value={propertyCondition} onChange={e => setPropertyCondition(e.target.value)}>
              <option value="">Select...</option>
              <option value="Excellent">Excellent</option>
              <option value="Good">Good</option>
              <option value="Fair">Fair</option>
              <option value="Poor">Poor</option>
              <option value="Needs Full Rehab">Needs Full Rehab</option>
              <option value="Teardown">Teardown</option>
            </select>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-3 space-y-3">
          <div>
            <label className={labelCls}>Post-Occupancy Terms</label>
            <textarea className={inputCls + ' resize-y min-h-[60px]'} rows={2} value={postOccupancy} onChange={e => setPostOccupancy(e.target.value)}
              placeholder="e.g. Seller may remain 30 days post-close at $0 rent..." />
          </div>
          <div>
            <label className={labelCls}>Addendums</label>
            <textarea className={inputCls + ' resize-y min-h-[60px]'} rows={2} value={addendums} onChange={e => setAddendums(e.target.value)}
              placeholder="e.g. Lead paint disclosure, as-is addendum..." />
          </div>
          <div>
            <label className={labelCls}>Amendments</label>
            <textarea className={inputCls + ' resize-y min-h-[60px]'} rows={2} value={amendments} onChange={e => setAmendments(e.target.value)}
              placeholder="e.g. Close date extended to 5/15/2026..." />
          </div>
          <div>
            <label className={labelCls}>Additional Contract Notes</label>
            <textarea className={inputCls + ' resize-y min-h-[60px]'} rows={2} value={contractNotes} onChange={e => setContractNotes(e.target.value)}
              placeholder="Any other terms, contingencies, or notes for buyers..." />
          </div>
        </div>
      </>
    )
  }

  function addPhotoUrls() {
    const raw = photoUrls.trim()
    if (!raw) return
    // Support comma/newline/space separated URLs
    const urls = raw.split(/[\s,\n]+/).filter(u => u.startsWith('http'))
    if (urls.length === 0) return
    setPendingPhotoUrls(prev => [...prev, ...urls])
    setPhotoUrls('')
  }

  function removePhotoUrl(idx: number) {
    setPendingPhotoUrls(prev => prev.filter((_, i) => i !== idx))
  }

  function renderStep7Photos() {
    const totalPhotos = pendingPhotos.length + pendingPhotoUrls.length
    return (
      <>
        <h3 className="text-xl font-bold text-slate-900 text-center">Photos</h3>
        <p className="text-sm text-slate-500 text-center mb-2">Add property photos to attract buyers.</p>

        {/* File upload */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handlePhotoFiles(e.dataTransfer.files) }}
          onClick={() => photoInputRef.current?.click()}
          className={cn(
            'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
            dragOver ? 'border-[#E32E2E] bg-[#E32E2E]/5' : 'border-slate-200 hover:border-slate-300'
          )}
        >
          <Icon name="add_photo_alternate" className="text-3xl text-slate-300 mb-1" />
          <p className="text-sm text-slate-500">Drop photos here or click to browse</p>
          <p className="text-xs text-slate-400 mt-0.5">JPG, PNG, WebP up to 10MB</p>
          <input
            ref={photoInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={e => handlePhotoFiles(e.target.files)}
          />
        </div>

        {/* Local file previews */}
        {photoPreviews.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {photoPreviews.map((src, i) => (
              <div key={`file-${i}`} className="relative group">
                <img src={src} alt="" className="w-full h-20 object-cover rounded-lg" />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removePhoto(i) }}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        {/* URL import — Google Photos, direct links, etc. */}
        <div className="border-t border-slate-100 pt-4">
          <label className={labelCls}>
            <Icon name="link" size="text-sm" className="inline mr-1 align-text-bottom" />
            Import from URL
          </label>
          <p className="text-xs text-slate-500 mb-2">Paste Google Photos links, image URLs, or share links — images are auto-converted to JPEG.</p>
          <div className="flex gap-2">
            <textarea
              className={inputCls + ' resize-none flex-1'}
              rows={2}
              value={photoUrls}
              onChange={e => setPhotoUrls(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addPhotoUrls() } }}
              placeholder="Paste image URL(s) — one per line or comma separated"
            />
            <button
              type="button"
              onClick={addPhotoUrls}
              disabled={!photoUrls.trim()}
              className="self-end bg-[#E32E2E] text-white text-xs font-semibold px-4 py-2.5 rounded-lg hover:bg-[#C42626] disabled:opacity-40 whitespace-nowrap"
            >
              Add
            </button>
          </div>
        </div>

        {/* Queued URL previews */}
        {pendingPhotoUrls.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-600">{pendingPhotoUrls.length} URL{pendingPhotoUrls.length !== 1 ? 's' : ''} queued for import</p>
            {pendingPhotoUrls.map((url, i) => (
              <div key={`url-${i}`} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 text-xs">
                <Icon name="image" size="text-sm" className="text-slate-400 flex-shrink-0" />
                <span className="flex-1 truncate text-slate-600">{url}</span>
                <button type="button" onClick={() => removePhotoUrl(i)} className="text-slate-400 hover:text-red-500 flex-shrink-0">&times;</button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-slate-400 text-center">
          {totalPhotos} photo{totalPhotos !== 1 ? 's' : ''} ready
          {pendingPhotoUrls.length > 0 && <span> ({pendingPhotoUrls.length} will be imported & converted on create)</span>}
        </p>
      </>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const stepRenderers = [renderStep0, renderStep1, renderStep2, renderStep3, renderStep4, renderStep5, renderStep6Terms, renderStep7Photos]
  const isLastStep = step === TOTAL_STEPS - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        {/* Header with progress */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-slate-900">New Deal</h2>
            <span className="text-xs text-slate-400">Step {step + 1} of {TOTAL_STEPS}</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="px-6 pt-3 pb-1 flex-shrink-0">
          <div className="flex gap-1">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className="flex-1 flex flex-col items-center">
                <div className={cn(
                  'h-1 w-full rounded-full transition-colors',
                  i <= step ? 'bg-[#E32E2E]' : 'bg-slate-100'
                )} />
                <span className={cn(
                  'text-[9px] mt-1 transition-colors',
                  i === step ? 'text-[#E32E2E] font-semibold' : i < step ? 'text-slate-500' : 'text-slate-300'
                )}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
          )}
          {stepRenderers[step]()}
        </div>

        {/* Footer with Back / Next */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-100 flex-shrink-0">
          {step > 0 ? (
            <button
              onClick={goBack}
              className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold"
            >
              Back
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold"
            >
              Cancel
            </button>
          )}
          <button
            onClick={goNext}
            disabled={!canAdvance() || creating}
            className="flex-1 bg-[#E32E2E] text-white hover:bg-[#C42626] rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {creating ? 'Creating...' : isLastStep ? 'Create Deal' : 'Next'}
          </button>
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
  const [liveStats, setLiveStats] = useState<{ views: number; unique_visitors: number; offers_submitted: number; shares: number } | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/deals/${page.slug}/stats`)
      .then(r => r.json())
      .then(d => { if (alive && d.summary) setLiveStats(d.summary) })
      .catch(() => {})
    return () => { alive = false }
  }, [page.slug])

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

        {/* Live stats (falls back to stored view_count until events accumulate) */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div className="text-center bg-slate-50 rounded-lg py-2">
            <p className="text-lg font-bold text-slate-900">{liveStats?.views ?? page.view_count}</p>
            <p className="text-[10px] text-slate-500">Views</p>
          </div>
          <div className="text-center bg-slate-50 rounded-lg py-2">
            <p className="text-lg font-bold text-slate-900">{liveStats?.unique_visitors ?? page.unique_visitors}</p>
            <p className="text-[10px] text-slate-500">Unique</p>
          </div>
          <div className="text-center bg-slate-50 rounded-lg py-2">
            <p className="text-lg font-bold text-slate-900">{liveStats?.shares ?? 0}</p>
            <p className="text-[10px] text-slate-500">Shares</p>
          </div>
          <div className="text-center bg-slate-50 rounded-lg py-2">
            <p className="text-lg font-bold text-[#E32E2E]">{liveStats?.offers_submitted ?? 0}</p>
            <p className="text-[10px] text-slate-500">Offers</p>
          </div>
        </div>

        {/* Expandable full stats panel */}
        <button
          onClick={() => setStatsOpen(!statsOpen)}
          className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-slate-900 py-1.5 mb-3 border-t border-b border-slate-100 transition-colors"
        >
          <Icon name={statsOpen ? 'expand_less' : 'analytics'} size="text-xs" />
          {statsOpen ? 'Hide analytics' : 'View full analytics'}
        </button>
        {statsOpen && (
          <div className="mb-3">
            <DealStatsPanel slug={page.slug} />
          </div>
        )}

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
function EditDealPageModal({ deal, onClose, onSaved, onDelete }: { deal: DealPage; onClose: () => void; onSaved: () => void; onDelete: (id: string) => void }) {
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
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
      if (!data.imported) {
        const details = Array.isArray(data.errors) && data.errors.length > 0
          ? `: ${data.errors.slice(0, 2).join('; ')}`
          : ''
        setPhotoImportStatus(`Error: no photos imported${details}`)
        return
      }
      if (Array.isArray(data.photos)) setPhotos(data.photos)
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
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
            <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30 resize-none" />
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
                      i < 5 && i > 0 ? 'ring-1 ring-amber-300' : ''
                    )}
                  >
                    <img src={url} alt="" className="w-full h-16 object-cover" />
                    {i === 0 && (
                      <span className="absolute bottom-0 left-0 right-0 bg-teal-600/90 text-white text-[9px] font-bold text-center py-0.5">COVER</span>
                    )}
                    {i >= 1 && i <= 4 && (
                      <span className="absolute bottom-0 left-0 right-0 bg-amber-600/70 text-white text-[9px] text-center py-0.5">#{i + 1}</span>
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
                className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30"
                disabled={importingPhotos}
              />
              <button
                type="button"
                onClick={importPhotoUrls}
                disabled={importingPhotos || !photoUrl.trim()}
                className="bg-[#E32E2E] text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-[#c72626] disabled:opacity-50 whitespace-nowrap"
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
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Earnest Money ($)</label>
                <input type="number" value={form.earnest_money} onChange={e => set('earnest_money', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Inspection (days)</label>
                <input type="number" value={form.inspection_period_days} onChange={e => set('inspection_period_days', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Financing</label>
                <input type="text" value={form.financing_terms} onChange={e => set('financing_terms', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Assignment Fee ($)</label>
                <input type="number" value={form.assignment_fee} onChange={e => set('assignment_fee', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Condition</label>
                <select value={form.property_condition} onChange={e => set('property_condition', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30">
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
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Repair Est. Low ($)</label>
                <input type="number" value={form.repair_estimate_low} onChange={e => set('repair_estimate_low', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30" />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-0.5">Repair Est. High ($)</label>
                <input type="number" value={form.repair_estimate_high} onChange={e => set('repair_estimate_high', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30" />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-[10px] text-slate-500 mb-0.5">Contract Notes</label>
              <textarea rows={2} value={form.contract_notes} onChange={e => set('contract_notes', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#E32E2E]/30 resize-none" />
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

          {/* Delete zone */}
          <div className="border-t border-slate-100 pt-3">
            {confirmDelete ? (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <p className="text-xs text-red-700 flex-1">Permanently delete this deal page?</p>
                <button
                  onClick={() => { onDelete(deal.id); onClose() }}
                  className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded px-2.5 py-1"
                >
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs font-semibold text-slate-600 hover:text-slate-800">
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="w-full flex items-center justify-center gap-1.5 text-slate-400 hover:text-red-500 text-xs py-1.5 transition-colors">
                <Icon name="delete" size="text-xs" />
                Delete Deal Page
              </button>
            )}
          </div>

          <div className="flex gap-3 pt-2 pb-1">
            <button onClick={onClose}
              className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 bg-[#E32E2E] text-white hover:bg-[#c72626] rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60">
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

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/deals/${id}`, { method: 'DELETE' })
      if (!res.ok) return
      setPages(prev => prev.filter(p => p.id !== id))
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
          onDelete={(id) => { handleDelete(id); setEditingDeal(null) }}
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
            className="bg-[#E32E2E] text-white hover:bg-[#c72626] rounded-lg px-5 py-2.5 text-sm font-semibold"
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
