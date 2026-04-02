'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { AriBriefing } from '@/components/leads/ari-briefing'
import { PainPoints } from '@/components/leads/pain-points'
import { SellersTimeline } from '@/components/leads/sellers-timeline'
import { FavoriteOrFool } from '@/components/leads/favorite-or-fool'
import { PropertyHero } from '@/components/leads/property-hero'
import { ActivityFeed } from '@/components/leads/activity-feed'
import { PropertyDetailsCard } from '@/components/leads/property-details-card'
import { TemperatureBadge } from '@/components/leads/temperature-badge'
import { FavoriteToggle } from '@/components/leads/favorite-toggle'
import { AddNote } from '@/components/leads/add-note'
import { ThankYouCard } from '@/components/leads/thank-you-card'
import { MailTracker } from '@/components/leads/mail-tracker'
import { ContractModal } from '@/components/leads/contract-modal'
import { AppointmentModal } from '@/components/leads/appointment-modal'
import { SellerGoals } from '@/components/leads/seller-goals'
import { createClient } from '@/lib/supabase/client'
import { toProperCase, formatPhone } from '@/lib/format'

interface Lead {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  source: string | null
  station: string | null
  priority: string | null
  notes: string | null
  assigned_agent: string | null
  created_at: string
  is_favorite: boolean | null
  beds: number | null
  baths_full: number | null
  baths_half: number | null
  sqft: number | null
  lot_size: number | null
  year_built: number | null
  basement_type: string | null
  stories: number | null
  garage_spaces: number | null
  roof_type: string | null
  heating: string | null
  cooling: string | null
  property_type: string | null
  zoning: string | null
  hoa_amount: number | null
  tax_assessment: number | null
  last_sale_date: string | null
  last_sale_price: number | null
  data_source: string | null
  data_enriched_at: string | null
  arv: number | null
  repair_estimate: number | null
  offer_amount: number | null
  assignment_fee: number | null
  motivation_score: number | null
  seller_situation: string | null
}

interface ActivityRow {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

function formatActivityTimestamp(ts: string): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function activityTypeToFeedType(type: string): 'sms' | 'call' | 'email' | 'status_change' {
  if (type === 'sms') return 'sms'
  if (type === 'call') return 'call'
  if (type === 'email') return 'email'
  return 'status_change'
}

// ─── Net Proceeds Calculator ─────────────────────────────────────────────────
interface NetProceedsCalcProps {
  leadId: string
  initialArv: number | null
  initialRepairs: number | null
  initialAskingPrice: number | null
  initialAssignmentFee: number | null
  initialBackTaxes?: number | null
  initialMortgage?: number | null
  initialLiens?: number | null
}

function NetProceedsCalc({ leadId, initialArv, initialRepairs, initialAskingPrice, initialAssignmentFee, initialBackTaxes, initialMortgage, initialLiens }: NetProceedsCalcProps) {
  const [arv, setArv] = useState(initialArv ?? 0)
  const [asIsValue, setAsIsValue] = useState(initialAskingPrice ? Math.round(initialAskingPrice * 1.1) : 0)
  const [askingPrice, setAskingPrice] = useState(initialAskingPrice ?? 0)
  const [mortgage, setMortgage] = useState(initialMortgage ?? 0)
  const [liens, setLiens] = useState(initialLiens ?? 0)
  const [taxes, setTaxes] = useState(initialBackTaxes ?? 0)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')

  const totalDebt = mortgage + liens + taxes
  const equitySurplus = asIsValue - totalDebt
  const estimatedAssignment = initialAssignmentFee ?? 0

  type FieldConfig = { key: string; label: string; value: number; editable: boolean; color?: string }

  const fields: FieldConfig[] = [
    { key: 'arv', label: 'ARV', value: arv, editable: true },
    { key: 'asIs', label: 'As-Is Valuation', value: asIsValue, editable: true },
    { key: 'asking', label: 'Asking Price', value: askingPrice, editable: true },
    { key: 'mortgage', label: 'Mortgage', value: mortgage, editable: true },
    { key: 'liens', label: 'Liens', value: liens, editable: true },
    { key: 'taxes', label: 'Back Taxes', value: taxes, editable: true },
  ]

  async function saveField(key: string, val: number) {
    const supabase = createClient()
    // Direct DB columns
    const fieldMap: Record<string, string> = {
      arv: 'arv',
      asking: 'offer_amount',
      repairs: 'repair_estimate',
      assignment: 'assignment_fee',
    }
    const col = fieldMap[key]
    if (col) {
      await supabase.from('leads').update({ [col]: val }).eq('id', leadId)
      return
    }
    // For taxes/liens/mortgage — store in the notes as JSON supplement
    // and update the manifest financials
    if (key === 'taxes' || key === 'liens' || key === 'mortgage') {
      const labelMap: Record<string, string> = { taxes: 'back_taxes', liens: 'liens_amount', mortgage: 'mortgage_balance' }
      // Update via manifest if one exists
      try {
        const res = await fetch(`/api/manifests?lead_id=${leadId}`)
        const data = await res.json()
        if (data.manifest?.id) {
          const manifest = data.manifest.manifest || {}
          if (!manifest.financials) manifest.financials = { liens: [] }
          manifest.financials[labelMap[key]] = val
          await fetch(`/api/manifests/${data.manifest.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manifest }),
          })
        }
      } catch { /* silent */ }
    }
  }

  function startEdit(key: string, val: number) {
    setEditingField(key)
    setInputValue(String(val))
  }

  function commitEdit(key: string) {
    const val = parseFloat(inputValue) || 0
    const setterMap: Record<string, (v: number) => void> = {
      arv: setArv, asIs: setAsIsValue, asking: setAskingPrice,
      mortgage: setMortgage, liens: setLiens, taxes: setTaxes,
    }
    setterMap[key]?.(val)
    saveField(key, val)
    setEditingField(null)
  }

  return (
    <section className="bg-[#1B2A4A] rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-5">
        <Icon name="calculate" className="!text-lg text-emerald-400" />
        <h2 className="text-sm font-black uppercase tracking-[0.15em] text-white">
          Net Proceeds Calculator
        </h2>
      </div>

      <div className="space-y-3">
        {fields.map(({ key, label, value, editable }) => (
          <div key={key} className="flex justify-between items-center">
            <span className="text-sm text-slate-400 font-medium">{label}</span>
            {editingField === key ? (
              <input
                autoFocus
                type="number"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onBlur={() => commitEdit(key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(key)
                  if (e.key === 'Escape') setEditingField(null)
                }}
                className="w-32 text-right text-sm font-bold text-white bg-white/10 border border-white/20 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            ) : (
              <span
                className={`text-sm font-bold text-white cursor-pointer hover:text-amber-300 transition-colors px-1 ${editable ? '' : ''}`}
                onDoubleClick={() => editable && startEdit(key, value)}
                title={editable ? 'Double-click to edit' : ''}
              >
                ${value.toLocaleString()}
              </span>
            )}
          </div>
        ))}

        {/* Divider */}
        <div className="border-t border-white/10 pt-3 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-400 font-medium">Total Debt</span>
            <span className="text-sm font-bold text-red-400">${totalDebt.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-400 font-medium">Equity / Surplus</span>
            <span className={`text-sm font-bold ${equitySurplus >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ${equitySurplus.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Assignment Fee - Big Number */}
        <div className="bg-white/5 rounded-xl p-4 mt-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-1">
            Estimated Assignment
          </p>
          <p className="text-3xl font-black text-white leading-none">
            ${estimatedAssignment.toLocaleString()}
          </p>
        </div>
      </div>

      <p className="text-[9px] text-slate-500 mt-3">Double-click any value to edit</p>
    </section>
  )
}

// ─── Email Compose Modal ──────────────────────────────────────────────────────
interface EmailComposeModalProps {
  leadId: string
  toEmail: string
  leadName: string | null
  onClose: () => void
  onSent: () => void
}

function EmailComposeModal({ leadId, toEmail, leadName, onClose, onSent }: EmailComposeModalProps) {
  const [to, setTo] = useState(toEmail)
  const [subject, setSubject] = useState(`${toProperCase(leadName) || 'Your'} Property – Saving KC`)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSend() {
    if (!to || !body.trim()) { setError('Recipient and message are required'); return }
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/conversations/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, to, subject, body: body.trim(), mode: 'email', agent: 'User' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      onSent()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to send email')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-purple-50">
            <div className="flex items-center gap-2">
              <Icon name="mail" className="text-purple-600" />
              <h2 className="text-lg font-bold text-gray-900">Send Email</h2>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <Icon name="close" />
            </button>
          </div>

          {/* Form */}
          <div className="px-6 py-4 space-y-3 flex-1">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">To</label>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Message</label>
              <textarea
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Type your message..."
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
              />
            </div>
            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
            <button onClick={onClose} className="flex-1 border border-gray-300 rounded-lg py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all">
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !body.trim()}
              className="flex-1 bg-purple-600 text-white rounded-lg py-2.5 text-sm font-bold hover:bg-purple-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {sending ? 'Sending...' : <><Icon name="send" size="text-sm" /> Send Email</>}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Edit Lead Slide-Over ─────────────────────────────────────────────────────
interface EditLeadPanelProps {
  lead: Lead
  onClose: () => void
  onSaved: (updated: Partial<Lead>) => void
}

function EditLeadPanel({ lead, onClose, onSaved }: EditLeadPanelProps) {
  const [form, setForm] = useState({
    full_name: lead.full_name ?? '',
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    property_address: lead.property_address ?? '',
    city: lead.city ?? '',
    state: lead.state ?? '',
    zip: lead.zip ?? '',
    county: lead.county ?? '',
    source: lead.source ?? '',
    station: lead.station ?? '',
    priority: lead.priority ?? '',
    notes: lead.notes ?? '',
    assigned_agent: lead.assigned_agent ?? '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lead.id, ...form }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        console.error('Failed to save lead:', data.error)
        return
      }
      onSaved(data.lead || form)
    } catch (err) {
      console.error('Failed to save lead:', err)
    } finally {
      setSaving(false)
      onClose()
    }
  }

  const fields: { key: keyof typeof form; label: string; type?: string; multiline?: boolean }[] = [
    { key: 'full_name', label: 'Full Name' },
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'property_address', label: 'Property Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'ZIP' },
    { key: 'county', label: 'County' },
    { key: 'source', label: 'Source' },
    { key: 'station', label: 'Station' },
    { key: 'priority', label: 'Priority' },
    { key: 'assigned_agent', label: 'Assigned Agent' },
    { key: 'notes', label: 'Notes', multiline: true },
  ]

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[400px] bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Edit Lead</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <Icon name="close" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {fields.map(({ key, label, type, multiline }) => (
            <div key={key}>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{label}</label>
              {multiline ? (
                <textarea
                  rows={4}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <input
                  type={type ?? 'text'}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
          <button onClick={onClose} className="flex-1 border border-gray-300 rounded-lg py-2 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition-all">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Manifest Panel ────────────────────────────────────────────────────────────
interface ManifestPanelProps {
  leadId: string
}

function ManifestPanel({ leadId }: ManifestPanelProps) {
  const [manifest, setManifest] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showRaw, setShowRaw] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    async function fetchManifest() {
      setLoading(true)
      try {
        const res = await fetch(`/api/manifests?lead_id=${leadId}`)
        const data = await res.json()
        if (data.manifest) {
          setManifest(data.manifest.manifest)
        }
      } catch (err) {
        console.error('Failed to fetch manifest:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchManifest()
  }, [leadId])

  async function handleCreateManifest() {
    setCreating(true)
    try {
      // First fetch the lead to get name/phone/email
      const supabase = createClient()
      const { data: leadData } = await supabase
        .from('leads')
        .select('full_name, phone, email, property_address, city, state, zip, station, priority, motivation_score, seller_situation, notes')
        .eq('id', leadId)
        .single()

      const nameParts = (leadData?.full_name || 'Unknown').split(' ')
      const res = await fetch('/api/manifests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          firstName: nameParts[0] || 'Unknown',
          lastName: nameParts.slice(1).join(' ') || undefined,
          phone: leadData?.phone || undefined,
          email: leadData?.email || undefined,
          propertyAddress: leadData?.property_address || undefined,
          city: leadData?.city || undefined,
          state: leadData?.state || undefined,
          zip: leadData?.zip || undefined,
          station: leadData?.station || 'intake',
          priority: (leadData?.priority === 'hot' ? 'hot' : leadData?.priority === 'high' ? 'warm' : 'cold') as 'hot' | 'warm' | 'cold',
          motivationScore: leadData?.motivation_score || undefined,
          sellerSituation: leadData?.seller_situation || undefined,
          notes: leadData?.notes || undefined,
          source: 'crm_manual',
        }),
      })
      const data = await res.json()
      if (data.manifest) {
        setManifest(data.manifest)
      } else {
        console.error('Create manifest error:', data.error)
      }
    } catch (err) {
      console.error('Failed to create manifest:', err)
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-[#1B2A4A] rounded-2xl p-6">
        <p className="text-sm text-slate-400">Loading manifest...</p>
      </div>
    )
  }

  if (!manifest) {
    return (
      <div className="bg-[#1B2A4A] rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="description" className="!text-lg text-amber-400" />
          <h2 className="text-sm font-black uppercase tracking-[0.15em] text-white">
            Lead Manifest
          </h2>
        </div>
        <p className="text-sm text-slate-400 mb-4">No manifest created yet</p>
        <button
          onClick={handleCreateManifest}
          disabled={creating}
          className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create Manifest'}
        </button>
      </div>
    )
  }

  const m = manifest
  const tierColor: Record<string, string> = {
    cream: 'bg-yellow-500/20 text-yellow-300',
    hot: 'bg-red-500/20 text-red-300',
    warm: 'bg-orange-500/20 text-orange-300',
    cool: 'bg-cyan-500/20 text-cyan-300',
    dead: 'bg-slate-500/20 text-slate-400',
  }

  return (
    <div className="bg-[#1B2A4A] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon name="description" className="!text-lg text-amber-400" />
          <h2 className="text-sm font-black uppercase tracking-[0.15em] text-white">
            Lead Manifest V{m.version}
          </h2>
        </div>
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="text-xs text-slate-400 hover:text-amber-400 transition-colors"
        >
          {showRaw ? 'Hide JSON' : 'View Raw JSON'}
        </button>
      </div>

      {showRaw ? (
        <pre className="text-[10px] text-slate-300 bg-black/30 p-3 rounded-lg overflow-x-auto max-h-96 overflow-y-auto">
          {JSON.stringify(m, null, 2)}
        </pre>
      ) : (
        <div className="space-y-3">
          {/* ── Header badges ── */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs font-bold">
              {m.currentStation}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
              m.priority === 'hot' ? 'bg-red-500/20 text-red-300' :
              m.priority === 'warm' ? 'bg-orange-500/20 text-orange-300' :
              'bg-blue-500/20 text-blue-300'
            }`}>
              {m.priority}
            </span>
            {m.tier && (
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${tierColor[m.tier] || 'bg-slate-500/20 text-slate-300'}`}>
                {m.tier}
              </span>
            )}
            {m.qualificationScore && (
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-xs font-bold">
                Score: {m.qualificationScore}
              </span>
            )}
            {m.owner?.deceased && (
              <span className="px-2 py-0.5 bg-red-500/30 text-red-300 rounded text-xs font-bold">DECEASED</span>
            )}
            {m.owner?.outOfState && (
              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded text-xs font-bold">OUT OF STATE</span>
            )}
          </div>

          {/* ── Owner ── */}
          {m.owner && (
            <div className="border-t border-white/10 pt-3">
              <p className="text-xs text-slate-500 uppercase font-bold mb-1">Owner</p>
              <p className="text-sm text-white font-medium">{m.owner.fullName}</p>
              {m.owner.phones?.length > 0 && <p className="text-xs text-slate-400">{m.owner.phones.join(', ')}</p>}
              {m.owner.emails?.length > 0 && <p className="text-xs text-slate-400">{m.owner.emails.join(', ')}</p>}
              {m.owner.contactPreference && <p className="text-[10px] text-slate-500">Prefers: {m.owner.contactPreference}</p>}
              {m.owner.personalityType && <p className="text-[10px] text-slate-500">Personality: {m.owner.personalityType}</p>}
              {m.owner.coOwners?.length > 0 && <p className="text-[10px] text-slate-500">Co-owners: {m.owner.coOwners.join(', ')}</p>}
            </div>
          )}

          {/* ── Property details ── */}
          {m.property?.dwelling && (m.property.dwelling.sqft || m.property.dwelling.bedrooms || m.property.dwelling.yearBuilt) && (
            <div className="border-t border-white/10 pt-3">
              <p className="text-xs text-slate-500 uppercase font-bold mb-1">Property</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {m.property.dwelling.bedrooms && <p className="text-slate-300"><span className="text-slate-500">Beds:</span> {m.property.dwelling.bedrooms}</p>}
                {m.property.dwelling.bathrooms && <p className="text-slate-300"><span className="text-slate-500">Baths:</span> {m.property.dwelling.bathrooms}</p>}
                {m.property.dwelling.sqft && <p className="text-slate-300"><span className="text-slate-500">Sqft:</span> {m.property.dwelling.sqft.toLocaleString()}</p>}
                {m.property.dwelling.yearBuilt && <p className="text-slate-300"><span className="text-slate-500">Built:</span> {m.property.dwelling.yearBuilt}</p>}
                {m.property.dwelling.propertyType && <p className="text-slate-300"><span className="text-slate-500">Type:</span> {m.property.dwelling.propertyType}</p>}
                {m.property.dwelling.roofType && <p className="text-slate-300"><span className="text-slate-500">Roof:</span> {m.property.dwelling.roofType}</p>}
                {m.property.dwelling.hvac && <p className="text-slate-300"><span className="text-slate-500">HVAC:</span> {m.property.dwelling.hvac}</p>}
                {m.property.dwelling.basement && <p className="text-slate-300"><span className="text-slate-500">Basement:</span> {m.property.dwelling.basement}</p>}
                {m.property.dwelling.exterior && <p className="text-slate-300"><span className="text-slate-500">Exterior:</span> {m.property.dwelling.exterior}</p>}
                {m.property.dwelling.garageSize && <p className="text-slate-300"><span className="text-slate-500">Garage:</span> {m.property.dwelling.garageSize}-car</p>}
              </div>
              {m.property.vacant && <p className="text-xs text-amber-400 mt-1 font-bold">VACANT</p>}
              {m.property.occupancy && <p className="text-[10px] text-slate-500">Occupancy: {m.property.occupancy}</p>}
            </div>
          )}

          {/* ── Condition ── */}
          {m.property?.condition?.overall && (
            <div className="border-t border-white/10 pt-3">
              <p className="text-xs text-slate-500 uppercase font-bold mb-1">Condition</p>
              <p className={`text-xs font-bold ${
                m.property.condition.overall === 'poor' || m.property.condition.overall === 'uninhabitable' ? 'text-red-400' :
                m.property.condition.overall === 'fair' ? 'text-amber-400' : 'text-green-400'
              }`}>{m.property.condition.overall}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] mt-1">
                {m.property.condition.roof && <p className="text-slate-400">Roof: {m.property.condition.roof}</p>}
                {m.property.condition.hvac && <p className="text-slate-400">HVAC: {m.property.condition.hvac}</p>}
                {m.property.condition.foundation && <p className="text-slate-400">Foundation: {m.property.condition.foundation}</p>}
                {m.property.condition.electrical && <p className="text-slate-400">Electrical: {m.property.condition.electrical}</p>}
                {m.property.condition.plumbing && <p className="text-slate-400">Plumbing: {m.property.condition.plumbing}</p>}
              </div>
              {m.property.condition.notes && <p className="text-[10px] text-slate-500 mt-1">{m.property.condition.notes}</p>}
            </div>
          )}

          {/* ── Assessment & Tax ── */}
          {(m.property?.assessment?.totalValue || m.property?.assessment?.appraisedTotal || m.property?.taxCollector?.totalOwed) && (
            <div className="border-t border-white/10 pt-3">
              <p className="text-xs text-slate-500 uppercase font-bold mb-1">Assessment & Tax</p>
              <div className="space-y-1 text-xs">
                {(m.property.assessment?.appraisedTotal || m.property.assessment?.totalValue) && (
                  <p className="text-white font-medium">
                    Appraised: ${(m.property.assessment.appraisedTotal || m.property.assessment.totalValue || 0).toLocaleString()}
                  </p>
                )}
                {m.property.assessment?.landValue && (
                  <p className="text-slate-400">Land: ${m.property.assessment.landValue.toLocaleString()}</p>
                )}
                {m.property.assessment?.improvementValue && (
                  <p className="text-slate-400">Improvements: ${m.property.assessment.improvementValue.toLocaleString()}</p>
                )}
                {m.property.taxCollector?.totalOwed && (
                  <p className="text-red-400 font-bold">Tax owed: ${m.property.taxCollector.totalOwed.toLocaleString()}</p>
                )}
                {m.property.taxCollector?.delinquentAmount && (
                  <p className="text-red-400">Delinquent: ${m.property.taxCollector.delinquentAmount.toLocaleString()}</p>
                )}
                {m.property.taxCollector?.yearsDelinquent && (
                  <p className="text-red-400 text-[10px]">{m.property.taxCollector.yearsDelinquent} years delinquent</p>
                )}
                {m.property.taxCollector?.taxStatus && (
                  <p className="text-[10px] text-slate-500">Status: {m.property.taxCollector.taxStatus}</p>
                )}
              </div>
            </div>
          )}

          {/* ── Financials ── */}
          {m.financials && (m.financials.arv || m.financials.as_is_value || m.financials.offer_amount || m.financials.mortgage_balance) && (
            <div className="border-t border-white/10 pt-3">
              <p className="text-xs text-slate-500 uppercase font-bold mb-1">Financials</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {m.financials.arv && <p className="text-green-400"><span className="text-slate-500">ARV:</span> ${m.financials.arv.toLocaleString()}</p>}
                {m.financials.as_is_value && <p className="text-slate-300"><span className="text-slate-500">As-is:</span> ${m.financials.as_is_value.toLocaleString()}</p>}
                {m.financials.repair_estimate && <p className="text-amber-400"><span className="text-slate-500">Repairs:</span> ${m.financials.repair_estimate.toLocaleString()}</p>}
                {m.financials.mortgage_balance && <p className="text-slate-300"><span className="text-slate-500">Mortgage:</span> ${m.financials.mortgage_balance.toLocaleString()}</p>}
                {m.financials.offer_amount && <p className="text-emerald-400 font-bold"><span className="text-slate-500">Offer:</span> ${m.financials.offer_amount.toLocaleString()}</p>}
                {m.financials.equity && <p className="text-white"><span className="text-slate-500">Equity:</span> ${m.financials.equity.toLocaleString()}</p>}
              </div>
            </div>
          )}

          {/* ── Flags ── */}
          {(m.flags?.redFlags?.length > 0 || m.flags?.opportunityFlags?.length > 0) && (
            <div className="border-t border-white/10 pt-3">
              {m.flags.redFlags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {m.flags.redFlags.map((f: string) => (
                    <span key={f} className="px-2 py-0.5 bg-red-500/20 text-red-300 rounded text-[10px] font-bold">{f}</span>
                  ))}
                </div>
              )}
              {m.flags.opportunityFlags?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {m.flags.opportunityFlags.map((f: string) => (
                    <span key={f} className="px-2 py-0.5 bg-green-500/20 text-green-300 rounded text-[10px] font-bold">{f}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Situation tags ── */}
          {m.situation?.type?.length > 0 && (
            <div className="border-t border-white/10 pt-3">
              <p className="text-xs text-slate-500 uppercase font-bold mb-1">Situation</p>
              <div className="flex flex-wrap gap-1">
                {m.situation.type.map((t: string) => (
                  <span key={t} className="px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded text-xs">{t}</span>
                ))}
              </div>
              {m.situation.summary && <p className="text-[10px] text-slate-400 mt-1">{m.situation.summary}</p>}
              {m.situation.motivation?.primary && (
                <p className="text-[10px] text-slate-400 mt-1">Motivation: {m.situation.motivation.primary}</p>
              )}
              {m.situation.motivation?.signals?.length > 0 && (
                <p className="text-[10px] text-amber-400 mt-1">Signals: {m.situation.motivation.signals.join(', ')}</p>
              )}
            </div>
          )}

          {/* ── Booking ── */}
          {m.booking?.scheduledDate && (
            <div className="border-t border-white/10 pt-3">
              <p className="text-xs text-slate-500 uppercase font-bold mb-1">Booking</p>
              <p className="text-sm text-white">
                {m.booking.scheduledDate} at {m.booking.scheduledTime}
              </p>
              <p className="text-xs text-slate-400 capitalize">{m.booking.type}</p>
            </div>
          )}

          {/* ── Contacts ── */}
          {m.contacts?.length > 0 && (
            <div className="border-t border-white/10 pt-3">
              <p className="text-xs text-slate-500 uppercase font-bold mb-1">Contacts</p>
              {m.contacts.map((c: any, i: number) => (
                <p key={i} className="text-[10px] text-slate-400">{c.name} ({c.role}){c.phone ? ` — ${c.phone}` : ''}</p>
              ))}
            </div>
          )}

          {/* ── Timestamps ── */}
          <div className="border-t border-white/10 pt-3">
            <p className="text-[9px] text-slate-500 font-mono">{m.manifestId}</p>
            <p className="text-[9px] text-slate-500">
              Created: {new Date(m.created).toLocaleDateString()} | Updated: {new Date(m.lastUpdated).toLocaleDateString()}
            </p>
            {m.source && <p className="text-[9px] text-slate-500">Source: {m.source}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [lead, setLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [manifestRowId, setManifestRowId] = useState<string | null>(null)
  const [manifestFinancials, setManifestFinancials] = useState<Record<string, number | null>>({ back_taxes: null, liens_amount: null, mortgage_balance: null })
  const [ghostProtocolStatus, setGhostProtocolStatus] = useState<{ phase: number; status: string } | null>(null)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [thankYouSent, setThankYouSent] = useState(false)
  const [editPanelOpen, setEditPanelOpen] = useState(false)
  const [contractModalOpen, setContractModalOpen] = useState(false)
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false)
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [notesModalOpen, setNotesModalOpen] = useState(false)
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false)
  const [activityDateFilter, setActivityDateFilter] = useState<'today' | 'week' | 'month' | 'all'>('all')
  const [activityTypeFilter, setActivityTypeFilter] = useState<string>('all')

  // ── Data fetching (runs on mount + after user actions) ──
  const [refreshTick, setRefreshTick] = useState(0)

  // Call this after any user action that changes data (note, call, edit, email, etc.)
  function refreshAll() { setRefreshTick(t => t + 1) }

  useEffect(() => {
    async function fetchLead() {
      const supabase = createClient()
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', id)
        .limit(1)
        .single()
      setLead(data as Lead)
      setLoading(false)
    }
    if (id) fetchLead()
  }, [id, refreshTick])

  useEffect(() => {
    async function fetchManifestId() {
      try {
        const res = await fetch(`/api/manifests?lead_id=${id}`)
        const data = await res.json()
        if (data.manifest?.id) {
          setManifestRowId(data.manifest.id)
          const fin = data.manifest.manifest?.financials || {}
          setManifestFinancials({
            back_taxes: fin.back_taxes ?? null,
            liens_amount: fin.liens_amount ?? null,
            mortgage_balance: fin.mortgage_balance ?? null,
          })
        }
      } catch { /* silent */ }
    }
    if (id) fetchManifestId()
  }, [id, refreshTick])

  useEffect(() => {
    async function fetchActivities() {
      const supabase = createClient()
      const { data } = await supabase
        .from('lead_activities')
        .select('id, activity_type, description, agent, metadata, created_at')
        .eq('lead_id', id)
        .order('created_at', { ascending: false })
        .limit(50)
      const rows = (data as ActivityRow[]) || []
      setActivities(rows)
      const ghostRow = rows.find((r) => r.activity_type === 'ghost_protocol_enrollment')
      if (ghostRow?.metadata?.status === 'active') {
        setGhostProtocolStatus({
          phase: ghostRow.metadata.current_phase as number,
          status: ghostRow.metadata.status as string,
        })
      }
      const letterRow = rows.find(
        (r) => r.activity_type === 'letter_tracking' && (r.metadata as Record<string, unknown>)?.letter_type === 'thank_you'
      )
      if (letterRow) setThankYouSent(true)
    }
    if (id) fetchActivities()
  }, [id, refreshTick])

  async function handleThankYouToggle() {
    if (thankYouSent) return
    const supabase = createClient()
    const { data } = await supabase.from('lead_activities').insert({
      lead_id: id,
      activity_type: 'letter_tracking',
      description: `Thank you letter sent to ${toProperCase(lead?.full_name)}`,
      agent: 'User',
      metadata: { letter_type: 'thank_you', sent_date: new Date().toISOString() },
    }).select('id, activity_type, description, agent, metadata, created_at').single()
    setThankYouSent(true)
    if (data) setActivities(prev => [data as ActivityRow, ...prev])
    refreshAll()
  }

  function handleNoteAdded(note: ActivityRow) {
    setActivities(prev => [note, ...prev])
    refreshAll()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        Loading lead...
      </div>
    )
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <p className="text-slate-500 font-medium">Lead not found</p>
        <Link href="/leads" className="text-primary hover:underline text-sm">Back to Leads</Link>
      </div>
    )
  }

  const addressLine = [lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
  const formattedName = toProperCase(lead.full_name)
  const formattedPhone = formatPhone(lead.phone)

  const property = {
    address: lead.property_address || '--',
    city: lead.city || undefined,
    state: lead.state || undefined,
    zip: lead.zip || undefined,
    county: lead.county || undefined,
    beds: lead.beds ?? 0,
    baths: (lead.baths_full ?? 0) + (lead.baths_half ? 0.5 : 0),
    sqft: lead.sqft ?? 0,
    yearBuilt: lead.year_built ?? 0,
    lotSize: lead.lot_size ? String(lead.lot_size) : '--',
    tags: [lead.station || 'intake', lead.priority || 'normal'].filter(Boolean),
  }

  // Filter activities by date and type
  const filteredActivities = activities.filter((a) => {
    // Date filter
    const activityDate = new Date(a.created_at)
    const now = new Date()

    if (activityDateFilter === 'today') {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      if (activityDate < today) return false
    } else if (activityDateFilter === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      if (activityDate < weekAgo) return false
    } else if (activityDateFilter === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      if (activityDate < monthAgo) return false
    }

    // Type filter
    if (activityTypeFilter !== 'all') {
      if (activityTypeFilter === 'note' && !['note', 'agent_note'].includes(a.activity_type)) return false
      if (activityTypeFilter === 'appointment' && a.activity_type !== 'appointment') return false
      if (activityTypeFilter !== 'note' && activityTypeFilter !== 'appointment' && a.activity_type !== activityTypeFilter) return false
    }

    return true
  })

  // Build feed activities - include notes, appointments, call recordings
  const feedActivities = filteredActivities
    .slice(0, 30)
    .map((a) => {
      let link: string | undefined
      let linkLabel: string | undefined
      let recordingUrl: string | undefined

      if (a.activity_type === 'status_change' && a.metadata) {
        const newStation = a.metadata.new_station as string | undefined
        const opportunityStages = ['qualifying', 'appt_set', 'negotiations']
        if (newStation && opportunityStages.includes(newStation)) {
          link = '/opportunities'
          linkLabel = 'View in Hot Opportunities'
        }
      }

      // Check for recording URL in call/voicemail activities
      if ((a.activity_type === 'call' || a.activity_type === 'voicemail') && a.metadata) {
        recordingUrl = (a.metadata.recordingUrl || a.metadata.recording_url || a.metadata.RecordingUrl) as string | undefined
      }

      const typeMap: Record<string, string> = {
        sms: 'SMS',
        call: 'Phone call',
        voicemail: 'Voicemail',
        email: 'Email',
        note: 'Agent Note',
        agent_note: 'Agent Note',
        task: 'Task',
        appointment: 'Appointment',
        contract_sent: 'Contract Sent',
        letter_tracking: 'Mail',
        status_change: 'Status update',
      }

      return {
        id: a.id,
        type: activityTypeToFeedType(a.activity_type),
        title: typeMap[a.activity_type] || a.activity_type.replace(/_/g, ' '),
        content: a.description || undefined,
        timestamp: formatActivityTimestamp(a.created_at),
        link,
        linkLabel,
        recordingUrl,
        rawType: a.activity_type,
        agentName: a.agent || undefined,
      }
    })

  // File checklist items
  const hasCalls = activities.some((a) => a.activity_type === 'call')
  const hasTimeline = !!lead.notes || hasCalls
  const hasCondition = !!(lead.beds || lead.sqft || lead.property_type)
  const hasMotivation = !!(lead.motivation_score || lead.seller_situation)
  const hasPrice = !!(lead.offer_amount || lead.arv)
  const hasFavorable = !!(lead.motivation_score && lead.motivation_score >= 6)

  const checklistItems = [
    { label: 'Timeline', done: hasTimeline, icon: 'schedule' },
    { label: 'Condition', done: hasCondition, icon: 'home' },
    { label: 'Motivation', done: hasMotivation, icon: 'psychology' },
    { label: 'Price', done: hasPrice, icon: 'payments' },
    { label: 'Favorable or Full Price', done: hasFavorable, icon: 'thumb_up' },
  ]

  // Build Zillow and county links
  const zillowUrl = addressLine
    ? `https://www.zillow.com/homes/${encodeURIComponent(addressLine)}`
    : null

  const countyTaxUrl = (() => {
    const county = lead.county?.toLowerCase()
    if (!county) return null
    if (county.includes('johnson')) return 'https://taxbill.jocogov.org/'
    if (county.includes('jackson')) return 'https://jacksoncountygov.com/170/Assessment'
    if (county.includes('clay')) return 'https://www.claycountymo.tax/'
    if (county.includes('platte')) return 'https://www.co.platte.mo.us/assessor'
    if (county.includes('wyandotte')) return 'https://www.wycokck.org/Departments/Appraiser'
    return null
  })()

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 mt-6 pb-20">
      {/* Lead Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap">
            <Link href="/leads" className="text-on-surface-variant hover:text-primary transition-colors shrink-0">
              <Icon name="arrow_back" size="text-xl" />
            </Link>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-primary tracking-tight break-words">
              {formattedName || 'Unknown'}
            </h1>
            <button
              onClick={() => setEditPanelOpen(true)}
              className="text-on-surface-variant/40 hover:text-primary transition-colors p-1"
              title="Edit lead"
            >
              <Icon name="edit" size="text-lg" />
            </button>
            <FavoriteToggle
              leadId={lead.id}
              isFavorite={lead.is_favorite ?? false}
              size="lg"
              onToggle={(val) => setLead(prev => prev ? { ...prev, is_favorite: val, priority: val ? 'hot' : prev.priority } : prev)}
            />
            <TemperatureBadge
              lead={{ priority: lead.priority, station: lead.station, created_at: lead.created_at }}
              size="lg"
              leadId={lead.id}
              onChanged={(p) => setLead(prev => prev ? { ...prev, priority: p } : prev)}
              clickable={true}
            />
            {ghostProtocolStatus && (
              <div className="px-3 py-1 bg-purple-100 border border-purple-300 rounded-full flex items-center gap-1.5">
                <Icon name="psychology" className="!text-sm text-purple-600" />
                <span className="text-[11px] font-black uppercase tracking-wide text-purple-700">
                  Ghost Protocol Phase {ghostProtocolStatus.phase}
                </span>
              </div>
            )}
          </div>

          <div className="ml-0 sm:ml-9 space-y-2">
            {/* Address + Email row */}
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-on-surface-variant flex items-center gap-2 text-sm">
                <Icon name="location_on" size="text-sm" />
                <span className="break-words">{addressLine || '--'}</span>
              </p>
              {lead.email && (
                <a
                  href={`mailto:${lead.email}`}
                  className="flex items-center gap-1.5 px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-md text-sm font-bold transition-colors"
                >
                  <Icon name="email" size="text-sm" />
                  {lead.email}
                </a>
              )}
            </div>
            {/* Phone numbers row */}
            {lead.phone && (
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={`tel:${lead.phone}`}
                  className="flex items-center gap-1.5 px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 rounded-md text-sm font-bold transition-colors"
                >
                  <Icon name="phone" size="text-sm" />
                  {formattedPhone}
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 sm:gap-3 flex-wrap sm:flex-nowrap shrink-0">
          <button
            onClick={() => setAppointmentModalOpen(true)}
            className="bg-surface-container-lowest border border-outline-variant/15 px-4 py-2.5 rounded-lg font-bold text-on-surface-variant hover:bg-surface-container-low transition-all text-sm flex items-center gap-1.5"
          >
            <Icon name="calendar_month" size="text-sm" />
            Appointment
          </button>
          <button
            onClick={() => setContractModalOpen(true)}
            className="bg-secondary text-on-secondary px-4 sm:px-6 py-2.5 rounded-lg font-bold hover:opacity-90 transition-all flex items-center gap-2 text-sm sm:text-base whitespace-nowrap"
          >
            <Icon name="bolt" />
            <span className="hidden sm:inline">Generate Contract</span>
            <span className="sm:hidden">Contract</span>
          </button>
        </div>
      </div>


      {/* 3-Column Layout */}
      <div className="grid grid-cols-12 gap-4 sm:gap-6 lg:gap-8 lg:items-start">
        {/* LEFT COLUMN: Ari Briefing, Pain Points, Sellers Timeline */}
        <div className="col-span-12 lg:col-span-3 space-y-6 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-6">
          <AriBriefing
            leadId={lead.id}
            manifestId={manifestRowId ?? undefined}
            personalityType={null}
            tacticalApproach={lead.notes || null}
            notes={lead.notes}
            sellerSituation={lead.seller_situation}
            motivationScore={lead.motivation_score}
            activities={activities}
          />

          <PainPoints
            leadId={lead.id}
            notes={lead.notes}
            sellerSituation={lead.seller_situation}
            motivationScore={lead.motivation_score}
            activities={activities}
          />

          <SellerGoals
            leadId={lead.id}
            notes={lead.notes}
            sellerSituation={lead.seller_situation}
            activities={activities}
          />

          <SellersTimeline
            leadCreatedAt={lead.created_at}
            station={lead.station}
            activities={activities}
          />

          <ThankYouCard leadId={lead.id} />

          <MailTracker leadId={lead.id} leadName={lead.full_name ?? undefined} />
        </div>

        {/* CENTER COLUMN: Property, Notes, Activity */}
        <div className="col-span-12 lg:col-span-6 space-y-6 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-6">
          <PropertyHero
            property={property}
            detailsExpanded={detailsExpanded}
            onToggleDetails={() => setDetailsExpanded((v) => !v)}
            arv={lead.arv}
            onNotesClick={() => setNotesModalOpen(true)}
          />

          {detailsExpanded && (
            <PropertyDetailsCard
              details={{
                beds: lead.beds,
                baths_full: lead.baths_full,
                baths_half: lead.baths_half,
                sqft: lead.sqft,
                lot_size: lead.lot_size,
                year_built: lead.year_built,
                basement_type: lead.basement_type,
                stories: lead.stories,
                garage_spaces: lead.garage_spaces,
                roof_type: lead.roof_type,
                heating: lead.heating,
                cooling: lead.cooling,
                property_type: lead.property_type,
                zoning: lead.zoning,
                hoa_amount: lead.hoa_amount,
                tax_assessment: lead.tax_assessment,
                last_sale_date: lead.last_sale_date,
                last_sale_price: lead.last_sale_price,
                data_source: lead.data_source,
                data_enriched_at: lead.data_enriched_at,
              }}
              address={addressLine}
              onEdit={() => setEditPanelOpen(true)}
            />
          )}

          {/* Activity Feed with recording support */}
          <div>
            {/* Activity Feed Header with Filter Button */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-primary">Activity Feed</h3>
              <div className="relative">
                <button
                  onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/20 rounded-lg text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition-all"
                >
                  <Icon name="filter_list" size="text-sm" />
                  <span>Filter</span>
                  {(activityDateFilter !== 'all' || activityTypeFilter !== 'all') && (
                    <span className="ml-1 px-1.5 py-0.5 bg-primary text-white text-xs rounded-full">
                      {(activityDateFilter !== 'all' ? 1 : 0) + (activityTypeFilter !== 'all' ? 1 : 0)}
                    </span>
                  )}
                  <Icon name={filterDropdownOpen ? 'expand_less' : 'expand_more'} size="text-sm" />
                </button>

                {/* Filter Dropdown Panel */}
                {filterDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setFilterDropdownOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-72 bg-surface-container-lowest border border-outline-variant/20 rounded-xl shadow-lg z-20 p-4 space-y-4">
                      {/* Date Filter */}
                      <div>
                        <p className="text-xs font-bold text-on-surface-variant uppercase mb-2">Date</p>
                        <div className="flex flex-wrap gap-2">
                          {(['today', 'week', 'month', 'all'] as const).map((filter) => (
                            <button
                              key={filter}
                              onClick={() => setActivityDateFilter(filter)}
                              className={`px-3 py-1 text-xs font-bold rounded-full transition-all ${
                                activityDateFilter === filter
                                  ? 'bg-primary text-white'
                                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                              }`}
                            >
                              {filter === 'today' ? 'Today' : filter === 'week' ? 'This Week' : filter === 'month' ? 'This Month' : 'All Time'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Type Filter */}
                      <div>
                        <p className="text-xs font-bold text-on-surface-variant uppercase mb-2">Type</p>
                        <div className="flex flex-wrap gap-2">
                          {(['all', 'call', 'voicemail', 'sms', 'email', 'task', 'note', 'appointment'] as const).map((filter) => (
                            <button
                              key={filter}
                              onClick={() => setActivityTypeFilter(filter)}
                              className={`px-3 py-1 text-xs font-bold rounded-full transition-all ${
                                activityTypeFilter === filter
                                  ? 'bg-primary text-white'
                                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                              }`}
                            >
                              {filter.charAt(0).toUpperCase() + filter.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <ActivityFeed
              activities={feedActivities}
              leadPhone={lead.phone ?? undefined}
              leadEmail={lead.email ?? undefined}
              leadId={id}
              onCompose={(type) => {
                if (type === 'call') {
                  if (lead.phone) window.location.href = `tel:${lead.phone}`
                } else if (type === 'sms') {
                  window.location.href = `/conversations?lead=${id}`
                } else if (type === 'email') {
                  if (lead.email) window.location.href = `mailto:${lead.email}`
                }
              }}
            />
            <div className="mt-3 text-right">
              <Link
                href={`/conversations?lead=${id}`}
                className="text-sm text-primary font-bold hover:underline"
              >
                View in Conversations
              </Link>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Favorite or Fool, Net Proceeds, File Checklist */}
        <div className="col-span-12 lg:col-span-3 space-y-6 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-6">
          <FavoriteOrFool
            leadId={lead.id}
            manifestId={manifestRowId ?? undefined}
            motivationScore={lead.motivation_score}
            arv={lead.arv}
            offerAmount={lead.offer_amount}
            repairEstimate={lead.repair_estimate}
            station={lead.station}
            notes={lead.notes}
            sellerSituation={lead.seller_situation}
          />

          <NetProceedsCalc
            leadId={id}
            initialArv={lead.arv}
            initialRepairs={lead.repair_estimate}
            initialAskingPrice={lead.offer_amount}
            initialAssignmentFee={lead.assignment_fee}
            initialBackTaxes={manifestFinancials.back_taxes}
            initialLiens={manifestFinancials.liens_amount}
            initialMortgage={manifestFinancials.mortgage_balance}
          />

          {/* Missing Information Checklist */}
          <div className="bg-blue-600 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Icon name="checklist" className="text-white" />
              <h3 className="text-sm font-black uppercase tracking-wider text-white">Missing Information</h3>
            </div>
            <ul className="space-y-2.5">
              {checklistItems.map((item) => (
                <li key={item.label} className="flex items-center gap-3 text-sm">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${item.done ? 'bg-green-400' : 'bg-white/20'}`}>
                    {item.done
                      ? <Icon name="check" className="!text-xs text-white" />
                      : <Icon name={item.icon} className="!text-[10px] text-white/50" />
                    }
                  </div>
                  <span className={item.done ? 'text-white font-semibold' : 'text-white/60'}>{item.label}</span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-white/40 mt-4">Auto-updated as data is received</p>
          </div>

          {/* Manifest Panel */}
          <ManifestPanel leadId={id} />
        </div>
      </div>

      {/* Modals */}
      {emailModalOpen && lead.email && (
        <EmailComposeModal
          leadId={lead.id}
          toEmail={lead.email}
          leadName={lead.full_name}
          onClose={() => setEmailModalOpen(false)}
          onSent={() => {
            refreshAll()
          }}
        />
      )}
      {editPanelOpen && (
        <EditLeadPanel
          lead={lead}
          onClose={() => setEditPanelOpen(false)}
          onSaved={(updated) => {
            setLead((prev) => prev ? { ...prev, ...updated } : prev)
            refreshAll()
          }}
        />
      )}
      {contractModalOpen && (
        <ContractModal
          lead={lead}
          onClose={() => setContractModalOpen(false)}
          onSuccess={() => { refreshAll() }}
        />
      )}
      {appointmentModalOpen && (
        <AppointmentModal
          lead={lead}
          onClose={() => setAppointmentModalOpen(false)}
          onSuccess={() => { refreshAll() }}
        />
      )}
      {notesModalOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setNotesModalOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-lg">
              <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
                <div className="flex items-center gap-2">
                  <Icon name="edit_note" className="text-primary" />
                  <h2 className="text-lg font-bold text-primary">Add Note</h2>
                </div>
                <button
                  onClick={() => setNotesModalOpen(false)}
                  className="text-on-surface-variant hover:text-primary transition-colors"
                >
                  <Icon name="close" />
                </button>
              </div>
              <div className="p-6">
                <AddNote
                  leadId={lead.id}
                  onNoteAdded={(note) => {
                    handleNoteAdded(note)
                    setNotesModalOpen(false)
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
