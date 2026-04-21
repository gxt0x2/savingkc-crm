'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { AriBriefing } from '@/components/leads/ari-briefing'
import { PainPoints } from '@/components/leads/pain-points'
import { FavoriteOrFool } from '@/components/leads/favorite-or-fool'
import { PropertyHero } from '@/components/leads/property-hero'
import { ActivityFeed } from '@/components/leads/activity-feed'
import { PropertyDetailsCard } from '@/components/leads/property-details-card'
import { TemperatureBadge } from '@/components/leads/temperature-badge'
import { FavoriteToggle } from '@/components/leads/favorite-toggle'
import { AddNote } from '@/components/leads/add-note'
import { EditNoteModal } from '@/components/leads/edit-note-modal'
import { ContractModal } from '@/components/leads/contract-modal'
import { AppointmentModal } from '@/components/leads/appointment-modal'
import { AppointmentOutcomeModal } from '@/components/leads/appointment-outcome-modal'
import { SmsComposeModal } from '@/components/leads/sms-compose-modal'
import { SellerGoals } from '@/components/leads/seller-goals'
import { DiscoveryQuestions } from '@/components/leads/discovery-questions'
import { AriChat } from '@/components/leads/ari-chat'
import { MailTracker } from '@/components/leads/mail-tracker'
import { NextAction } from '@/components/leads/next-action'
import { MissingInfoCard } from '@/components/leads/missing-info-card'
import { CockpitModal } from '@/components/ui/cockpit-modal'
import { SortableColumn } from '@/components/ui/sortable-column'
import { NewTaskModal } from '@/components/modals/new-task-modal'
import { EditTaskModal } from '@/components/modals/edit-task-modal'
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
  try {
    const d = new Date(ts)
    // Check if date is valid
    if (isNaN(d.getTime())) {
      return 'Unknown date'
    }
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    // For recent items, show relative time with actual time
    const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

    if (diffMins < 60) return `${diffMins}m ago · ${timeStr}`
    const diffHrs = Math.floor(diffMins / 60)
    if (diffHrs < 24) return `${diffHrs}h ago · ${timeStr}`
    const diffDays = Math.floor(diffHrs / 24)
    if (diffDays < 7) return `${diffDays}d ago · ${timeStr}`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` · ${timeStr}`
  } catch {
    return 'Unknown date'
  }
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
    <section
      className="rounded-2xl p-5 border"
      style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
    >
      <div className="flex items-center gap-2 mb-5">
        <Icon name="calculate" className="!text-base !text-[color:var(--ck-accent)]" />
        <h2 className="ck-microlabel !text-[11px] !text-white">Net Proceeds</h2>
      </div>

      <div className="space-y-2.5">
        {fields.map(({ key, label, value, editable }) => (
          <div key={key} className="flex justify-between items-center">
            <span className="text-xs font-medium" style={{ color: 'var(--ck-text-muted)' }}>{label}</span>
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
                className="w-28 text-right text-sm font-bold text-white rounded px-2 py-0.5 focus:outline-none focus:ring-1"
                style={{
                  background: 'var(--ck-surface-elev)',
                  border: '1px solid var(--ck-border)',
                }}
              />
            ) : (
              <span
                className="text-sm font-bold text-white cursor-pointer hover:opacity-70 transition-opacity px-1"
                onDoubleClick={() => editable && startEdit(key, value)}
                title={editable ? 'Double-click to edit' : ''}
              >
                ${value.toLocaleString()}
              </span>
            )}
          </div>
        ))}

        {/* Divider */}
        <div
          className="pt-3 space-y-2.5"
          style={{ borderTop: '1px solid var(--ck-border)' }}
        >
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium" style={{ color: 'var(--ck-text-muted)' }}>Total Debt</span>
            <span className="text-sm font-bold" style={{ color: 'var(--ck-accent)' }}>
              ${totalDebt.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium" style={{ color: 'var(--ck-text-muted)' }}>Equity / Surplus</span>
            <span
              className="text-sm font-bold"
              style={{ color: equitySurplus >= 0 ? 'var(--ck-success)' : 'var(--ck-accent)' }}
            >
              ${equitySurplus.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Assignment Fee - Big Number */}
        <div
          className="rounded-xl p-4 mt-1 border"
          style={{ background: 'var(--ck-surface-elev)', borderColor: 'var(--ck-border)' }}
        >
          <p className="ck-microlabel mb-1" style={{ color: 'var(--ck-accent)' }}>
            Estimated Assignment
          </p>
          <p className="text-3xl font-black text-white leading-none tracking-tight">
            ${estimatedAssignment.toLocaleString()}
          </p>
        </div>
      </div>

      <p className="text-[9px] mt-3" style={{ color: 'var(--ck-text-dim)' }}>
        Double-click any value to edit
      </p>
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
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="ck-dark rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden border"
          style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-6 py-4 border-b"
            style={{ borderColor: 'var(--ck-border)' }}
          >
            <div className="flex items-center gap-2">
              <Icon name="mail" className="!text-base !text-[color:var(--ck-accent)]" />
              <h2 className="text-lg font-bold text-white">Send Email</h2>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: 'var(--ck-surface-elev)', color: 'var(--ck-text)' }}
            >
              <Icon name="close" className="!text-base" />
            </button>
          </div>

          {/* Form */}
          <div className="px-6 py-4 space-y-3 flex-1">
            <div>
              <label
                className="ck-microlabel mb-1 block !text-[10px]"
                style={{ color: 'var(--ck-text-muted)' }}
              >
                To
              </label>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[color:var(--ck-accent)]"
                style={{ background: 'var(--ck-surface-elev)', border: '1px solid var(--ck-border)', color: 'var(--ck-text)' }}
              />
            </div>
            <div>
              <label
                className="ck-microlabel mb-1 block !text-[10px]"
                style={{ color: 'var(--ck-text-muted)' }}
              >
                Subject
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[color:var(--ck-accent)]"
                style={{ background: 'var(--ck-surface-elev)', border: '1px solid var(--ck-border)', color: 'var(--ck-text)' }}
              />
            </div>
            <div>
              <label
                className="ck-microlabel mb-1 block !text-[10px]"
                style={{ color: 'var(--ck-text-muted)' }}
              >
                Message
              </label>
              <textarea
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Type your message..."
                autoFocus
                className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[color:var(--ck-accent)] resize-none"
                style={{ background: 'var(--ck-surface-elev)', border: '1px solid var(--ck-border)', color: 'var(--ck-text)' }}
              />
            </div>
            {error && <p className="text-sm font-medium" style={{ color: 'var(--ck-accent-bright)' }}>{error}</p>}
          </div>

          {/* Footer */}
          <div
            className="px-6 py-4 border-t flex gap-3"
            style={{ borderColor: 'var(--ck-border)' }}
          >
            <button
              onClick={onClose}
              className="flex-1 rounded-lg py-2.5 text-sm font-bold transition-all"
              style={{ background: 'var(--ck-surface-elev)', border: '1px solid var(--ck-border)', color: 'var(--ck-text)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !body.trim()}
              className="flex-1 rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              style={{ background: 'var(--ck-accent)' }}
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
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" onClick={onClose} />
      <div
        className="fixed right-0 top-0 bottom-0 w-[400px] shadow-2xl z-50 flex flex-col overflow-hidden border-l"
        style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--ck-border)' }}
        >
          <div className="flex items-center gap-2">
            <Icon name="edit" className="!text-base !text-[color:var(--ck-accent)]" />
            <h2 className="text-lg font-bold text-white">Edit Lead</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ background: 'var(--ck-surface-elev)', color: 'var(--ck-text)' }}
          >
            <Icon name="close" className="!text-base" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {fields.map(({ key, label, type, multiline }) => (
            <div key={key}>
              <label
                className="ck-microlabel mb-1 block !text-[10px]"
                style={{ color: 'var(--ck-text-muted)' }}
              >
                {label}
              </label>
              {multiline ? (
                <textarea
                  rows={4}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[color:var(--ck-accent)]"
                  style={{
                    background: 'var(--ck-surface-elev)',
                    border: '1px solid var(--ck-border)',
                    color: 'var(--ck-text)',
                  }}
                />
              ) : (
                <input
                  type={type ?? 'text'}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[color:var(--ck-accent)]"
                  style={{
                    background: 'var(--ck-surface-elev)',
                    border: '1px solid var(--ck-border)',
                    color: 'var(--ck-text)',
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <div
          className="px-6 py-4 border-t flex gap-3"
          style={{ borderColor: 'var(--ck-border)' }}
        >
          <button
            onClick={onClose}
            className="flex-1 rounded-lg py-2 text-sm font-bold transition-all"
            style={{
              background: 'var(--ck-surface-elev)',
              border: '1px solid var(--ck-border)',
              color: 'var(--ck-text)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-lg py-2 text-sm font-bold text-white disabled:opacity-50 transition-all"
            style={{ background: 'var(--ck-accent)' }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Manifest Panel — compact cockpit summary ────────────────────────────────
interface ManifestPanelProps {
  leadId: string
}

function ManifestPanel({ leadId }: ManifestPanelProps) {
  const [manifest, setManifest] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    async function fetchManifest() {
      setLoading(true)
      try {
        const res = await fetch(`/api/manifests?lead_id=${leadId}`)
        const data = await res.json()
        if (data.manifest) setManifest(data.manifest.manifest)
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
      if (data.manifest) setManifest(data.manifest)
    } catch (err) {
      console.error('Failed to create manifest:', err)
    } finally {
      setCreating(false)
    }
  }

  const cardStyle: React.CSSProperties = { background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }

  if (loading) {
    return (
      <section className="rounded-2xl p-4 border" style={cardStyle}>
        <p className="text-xs" style={{ color: 'var(--ck-text-muted)' }}>Loading manifest…</p>
      </section>
    )
  }

  if (!manifest) {
    return (
      <section className="rounded-2xl p-4 border" style={cardStyle}>
        <div className="flex items-center gap-2 mb-3">
          <Icon name="description" className="!text-sm !text-[color:var(--ck-accent)]" />
          <h2 className="ck-microlabel !text-[11px] !text-white">Manifest</h2>
        </div>
        <button
          onClick={handleCreateManifest}
          disabled={creating}
          className="w-full h-9 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
          style={{ background: 'var(--ck-accent)', color: '#fff' }}
        >
          {creating ? 'Creating…' : 'Create Manifest'}
        </button>
      </section>
    )
  }

  const m = manifest

  // Top-line signals only — keep this small.
  const signals: Array<{ label: string; value: string; tone?: 'accent' | 'warn' | 'muted' }> = []
  if (m.currentStation) signals.push({ label: 'Station', value: String(m.currentStation), tone: 'accent' })
  if (m.priority) signals.push({ label: 'Priority', value: String(m.priority), tone: m.priority === 'hot' ? 'accent' : 'muted' })
  if (m.tier) signals.push({ label: 'Tier', value: String(m.tier), tone: 'muted' })
  if (m.qualificationScore != null) signals.push({ label: 'Score', value: String(m.qualificationScore), tone: 'muted' })

  const flagRed: string[] = m.flags?.redFlags || []
  const flagOpp: string[] = m.flags?.opportunityFlags || []
  const situationTypes: string[] = m.situation?.type || []
  const motivationSignals: string[] = m.situation?.motivation?.signals || []
  const taxOwed = m.property?.taxCollector?.totalOwed ?? m.property?.taxCollector?.delinquentAmount
  const vacant = m.property?.vacant
  const deceased = m.owner?.deceased
  const outOfState = m.owner?.outOfState

  function toneColor(tone?: 'accent' | 'warn' | 'muted'): string {
    if (tone === 'accent') return 'var(--ck-accent-bright)'
    if (tone === 'warn') return 'var(--ck-warn)'
    return 'var(--ck-text)'
  }

  return (
    <section className="rounded-2xl p-4 border" style={cardStyle}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Icon name="description" className="!text-sm !text-[color:var(--ck-accent)]" />
          <span className="ck-microlabel !text-[11px] !text-white">Manifest</span>
          {m.version ? (
            <span className="text-[10px] font-bold" style={{ color: 'var(--ck-text-dim)' }}>v{m.version}</span>
          ) : null}
        </div>
        <Icon name={open ? 'expand_less' : 'expand_more'} className="!text-sm !text-[color:var(--ck-text-muted)]" />
      </button>

      {/* Always-visible top-line signals */}
      {signals.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {signals.map((s) => (
            <span
              key={s.label}
              className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
              style={{
                borderColor: 'var(--ck-border-strong)',
                background: 'var(--ck-surface-elev)',
                color: toneColor(s.tone),
              }}
            >
              {s.label}: {s.value}
            </span>
          ))}
          {deceased && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--ck-accent-bright)' }}>Deceased</span>
          )}
          {outOfState && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--ck-warn)' }}>Out of State</span>
          )}
          {vacant && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--ck-warn)' }}>Vacant</span>
          )}
        </div>
      )}

      {/* Expanded body — still compact */}
      {open && (
        <div className="mt-3 space-y-2.5 text-xs" style={{ color: 'var(--ck-text)' }}>
          {m.owner?.fullName && (
            <div>
              <p className="ck-microlabel mb-0.5">Owner</p>
              <p className="font-semibold">{m.owner.fullName}</p>
              {m.owner.coOwners?.length > 0 && (
                <p className="text-[10px]" style={{ color: 'var(--ck-text-muted)' }}>+ {m.owner.coOwners.join(', ')}</p>
              )}
            </div>
          )}

          {situationTypes.length > 0 && (
            <div>
              <p className="ck-microlabel mb-1">Situation</p>
              <div className="flex flex-wrap gap-1">
                {situationTypes.map((t: string) => (
                  <span
                    key={t}
                    className="text-[10px] px-1.5 py-0.5 rounded border"
                    style={{ borderColor: 'var(--ck-border-strong)', color: 'var(--ck-text-muted)' }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(flagRed.length > 0 || flagOpp.length > 0) && (
            <div>
              <p className="ck-microlabel mb-1">Flags</p>
              <div className="flex flex-wrap gap-1">
                {flagRed.map((f) => (
                  <span
                    key={'r-' + f}
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--ck-accent-bright)' }}
                  >
                    {f}
                  </span>
                ))}
                {flagOpp.map((f) => (
                  <span
                    key={'o-' + f}
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--ck-success)' }}
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {motivationSignals.length > 0 && (
            <div>
              <p className="ck-microlabel mb-1">Motivation Signals</p>
              <p className="text-[11px] leading-snug" style={{ color: 'var(--ck-text)' }}>
                {motivationSignals.slice(0, 4).join(' · ')}
              </p>
            </div>
          )}

          {taxOwed ? (
            <div className="flex items-center justify-between">
              <span className="ck-microlabel">Tax Owed</span>
              <span className="text-xs font-bold" style={{ color: 'var(--ck-accent-bright)' }}>
                ${Number(taxOwed).toLocaleString()}
              </span>
            </div>
          ) : null}

          <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid var(--ck-border)' }}>
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="text-[10px] font-bold hover:underline"
              style={{ color: 'var(--ck-text-muted)' }}
            >
              {showRaw ? 'Hide JSON' : 'View raw'}
            </button>
            <p className="text-[9px] font-mono" style={{ color: 'var(--ck-text-dim)' }}>
              {m.manifestId?.slice(0, 12) || ''}
            </p>
          </div>

          {showRaw && (
            <pre
              className="text-[10px] p-2 rounded-lg overflow-x-auto max-h-64 overflow-y-auto"
              style={{
                background: 'var(--ck-surface-elev)',
                border: '1px solid var(--ck-border)',
                color: 'var(--ck-text-muted)',
              }}
            >
              {JSON.stringify(m, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
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
  const [manifestProperty, setManifestProperty] = useState<Record<string, any> | null>(null)
  const [ownerDeceased, setOwnerDeceased] = useState<boolean>(false)
  const [zestimate, setZestimate] = useState<number | null>(null)
  const [assessedValue, setAssessedValue] = useState<number | null>(null)
  const [redfinEstimate, setRedfinEstimate] = useState<number | null>(null)
  const [zillowEnriching, setZillowEnriching] = useState(false)
  const [redfinEnriching, setRedfinEnriching] = useState(false)
  const [ghostProtocolStatus, setGhostProtocolStatus] = useState<{ phase: number; status: string } | null>(null)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [editPanelOpen, setEditPanelOpen] = useState(false)
  const [netProceedsOpen, setNetProceedsOpen] = useState(false)
  const [contractModalOpen, setContractModalOpen] = useState(false)
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false)
  const [showNewTask, setShowNewTask] = useState(false)
  const [outcomeModalOpen, setOutcomeModalOpen] = useState(false)
  const [outcomeModalDismissed, setOutcomeModalDismissed] = useState(false)
  const [manifestAppointment, setManifestAppointment] = useState<any>(null)
  const [manifestScore, setManifestScore] = useState<number | null>(null)
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [notesModalOpen, setNotesModalOpen] = useState(false)
  const [smsModalOpen, setSmsModalOpen] = useState(false)
  const [composeTab, setComposeTab] = useState<'sms' | 'email'>('sms')
  const [editNoteId, setEditNoteId] = useState<string | null>(null)
  const [editNoteContent, setEditNoteContent] = useState('')
  const [editTaskId, setEditTaskId] = useState<string | null>(null)
  const [editTaskTitle, setEditTaskTitle] = useState('')
  const [editTaskMetadata, setEditTaskMetadata] = useState<Record<string, unknown>>({})
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false)
  const [activityDateFilter, setActivityDateFilter] = useState<'today' | 'week' | 'month' | 'all'>('all')
  const [activityTypeFilter, setActivityTypeFilter] = useState<string>('all')

  // ── Auto-show appointment outcome modal when appointment time has passed ──
  useEffect(() => {
    if (outcomeModalDismissed || outcomeModalOpen) return
    if (!manifestAppointment?.scheduledAt) return
    const activeStatuses = ['scheduled', 'confirmed', 'reconfirmed']
    if (!activeStatuses.includes(manifestAppointment.status)) return
    if (new Date(manifestAppointment.scheduledAt).getTime() < Date.now()) {
      setOutcomeModalOpen(true)
    }
  }, [manifestAppointment, outcomeModalDismissed, outcomeModalOpen])

  // ── Data fetching (runs on mount + after user actions) ──
  const [refreshTick, setRefreshTick] = useState(0)

  // Call this after any user action that changes data (note, call, edit, email, etc.)
  function refreshAll() {
    setRefreshTick(t => t + 1)
    // Fan out to every sub-card (AriBriefing, PainPoints, SellerGoals, NextAction, FavoriteOrFool, etc.)
    // so they all re-read manifest/activities in one go.
    window.dispatchEvent(new CustomEvent('crm:lead-refresh', { detail: { leadId: id } }))
  }

  // Listen for disposition logged events from the telephony bar
  useEffect(() => {
    function onDisposition(e: Event) {
      const detail = (e as CustomEvent).detail as { leadId?: string }
      if (detail?.leadId === id) refreshAll()
    }
    window.addEventListener('crm:disposition-logged', onDisposition)
    return () => window.removeEventListener('crm:disposition-logged', onDisposition)
  }, [id])

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

  // The manifest's owner.deceased can drift (we've seen manifests built from
  // the wrong owner's prospect). Fall back to prospects.is_deceased so the
  // heirs panel appears whenever any linked prospect is flagged deceased.
  useEffect(() => {
    if (!id) return
    async function fetchProspectDeceased() {
      const supabase = createClient()
      const { data } = await supabase
        .from('prospects')
        .select('is_deceased')
        .eq('lead_id', id)
        .limit(50)
      if ((data ?? []).some((r: { is_deceased: boolean | null }) => r.is_deceased)) {
        setOwnerDeceased(true)
      }
    }
    fetchProspectDeceased()
  }, [id])

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
          // Store property object for PropertyDetailsCard manifest fallback
          setManifestProperty(data.manifest.manifest?.property || null)
          // Track deceased flag for the heirs section.
          // Additive only: if the manifest says deceased we flip to true, but
          // never flip back to false — the prospects-table fetch is the other
          // source and the OR must hold across both.
          if (data.manifest.manifest?.owner?.deceased) setOwnerDeceased(true)
          // Two independent values: live Zillow zestimate and county/tax assessed value.
          const m = data.manifest.manifest || {}
          const property = m.property || {}
          const zillow = typeof fin.zillow_zestimate === 'number' && fin.zillow_zestimate > 0
            ? fin.zillow_zestimate
            : null
          const appraised =
            (typeof property.assessment?.appraisedTotal === 'number' && property.assessment.appraisedTotal > 0
              ? property.assessment.appraisedTotal
              : null) ??
            (typeof property.assessment?.totalValue === 'number' && property.assessment.totalValue > 0
              ? property.assessment.totalValue
              : null)
          setZestimate(zillow)
          setAssessedValue(appraised)
          const redfin = typeof fin.redfin_estimate === 'number' && fin.redfin_estimate > 0
            ? fin.redfin_estimate
            : null
          setRedfinEstimate(redfin)
          // Store appointment data for outcome modal
          setManifestAppointment(data.manifest.manifest?.pipeline?.appointment || null)
          // Qualification score for header chip
          const qs = data.manifest.manifest?.qualificationScore
          setManifestScore(typeof qs === 'number' ? qs : null)
        }
      } catch { /* silent */ }
    }
    if (id) fetchManifestId()
  }, [id, refreshTick])

  // On-demand Zillow enrichment: if manifest loaded but has no zestimate yet,
  // fire the enrichment endpoint once and bump refreshTick when it returns.
  useEffect(() => {
    if (!lead || !manifestRowId) return
    if (zestimate != null) return
    if (zillowEnriching) return
    if (!lead.property_address) return

    const sessionKey = `crm_zillow_tried_${lead.id}`
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(sessionKey)) return

    setZillowEnriching(true)
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(sessionKey, '1')
    fetch('/api/enrich-zillow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: lead.id }),
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.zestimate) refreshAll()
      })
      .catch(() => { /* silent — enrichment is best-effort */ })
      .finally(() => setZillowEnriching(false))
  }, [lead, manifestRowId, zestimate, zillowEnriching])

  // On-demand Redfin enrichment (parallel to Zillow). Same best-effort pattern.
  useEffect(() => {
    if (!lead || !manifestRowId) return
    if (redfinEstimate != null) return
    if (redfinEnriching) return
    if (!lead.property_address) return

    const sessionKey = `crm_redfin_tried_${lead.id}`
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(sessionKey)) return

    setRedfinEnriching(true)
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(sessionKey, '1')
    fetch('/api/enrich-redfin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: lead.id }),
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.redfinEstimate) refreshAll()
      })
      .catch(() => { /* silent */ })
      .finally(() => setRedfinEnriching(false))
  }, [lead, manifestRowId, redfinEstimate, redfinEnriching])

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
    }
    if (id) fetchActivities()
  }, [id, refreshTick])

  // ── Lightweight poll: detect external events (calls, voicemails, SMS) ──
  // Only checks latest activity timestamp every 15s. No refetch unless new data exists.
  useEffect(() => {
    if (!id) return
    let lastSeen = activities[0]?.created_at || ''
    const interval = setInterval(async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('lead_activities')
          .select('created_at')
          .eq('lead_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const latest = data?.created_at || ''
        if (latest && latest !== lastSeen) {
          lastSeen = latest
          refreshAll()
        }
      } catch { /* silent */ }
    }, 15000)
    return () => clearInterval(interval)
  }, [id]) // intentionally no refreshTick dep — runs independently

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

  const initials = (formattedName || 'N/A')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  const lastActivityTs = activities[0]?.created_at || lead.created_at
  const lastActivityLabel = (() => {
    try {
      const d = new Date(lastActivityTs)
      const diffMs = Date.now() - d.getTime()
      const mins = Math.floor(diffMs / 60_000)
      if (mins < 1) return 'Active just now'
      if (mins < 60) return `Active ${mins}m ago`
      const hrs = Math.floor(mins / 60)
      if (hrs < 24) return `Active ${hrs}h ago`
      const days = Math.floor(hrs / 24)
      if (days < 30) return `Active ${days}d ago`
      return `Active ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    } catch {
      return 'Active recently'
    }
  })()

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

  // Merge disposition-only call rows (description "Call: <dispo>") into their
  // parent telephony call row (the "Outbound/Inbound call ..." entry) so the
  // disposition badge lands on the row with caller name + duration.
  const mergedActivities = (() => {
    const asc = [...filteredActivities].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    )
    const dropIds = new Set<string>()
    const dispoByCallId = new Map<string, { disposition: string; notes?: string }>()
    for (let i = 0; i < asc.length; i++) {
      const row = asc[i]
      if (row.activity_type !== 'call') continue
      const m = (row.metadata || {}) as Record<string, unknown>
      const isDispoOnly = !!m.disposition && !m.direction && !m.status
      if (!isDispoOnly) continue
      const phone = (m.phone as string | undefined)?.trim() || ''
      for (let j = i - 1; j >= 0; j--) {
        const prev = asc[j]
        if (prev.activity_type !== 'call') continue
        const pm = (prev.metadata || {}) as Record<string, unknown>
        if (!pm.direction) continue
        if (dispoByCallId.has(prev.id)) continue
        const prevPhone = ((pm.to as string | undefined) || (pm.from as string | undefined) || '').trim()
        if (phone && prevPhone && phone !== prevPhone) continue
        dispoByCallId.set(prev.id, {
          disposition: m.disposition as string,
          notes: m.notes as string | undefined,
        })
        dropIds.add(row.id)
        break
      }
    }
    return filteredActivities
      .filter((a) => !dropIds.has(a.id))
      .map((a) => {
        const extra = dispoByCallId.get(a.id)
        if (!extra) return a
        const existingMeta = (a.metadata || {}) as Record<string, unknown>
        return {
          ...a,
          metadata: {
            ...existingMeta,
            disposition: extra.disposition,
            notes: (existingMeta.notes as string | undefined) || extra.notes,
          },
        }
      })
  })()

  // Build feed activities - include notes, appointments, call recordings
  const feedActivities = mergedActivities
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
        appointment_outcome: 'Appointment Outcome',
        contract_sent: 'Contract Sent',
        letter_tracking: 'Mail',
        status_change: 'Status update',
      }

      // Determine direction for calls/SMS
      let title = typeMap[a.activity_type] || a.activity_type.replace(/_/g, ' ')
      const direction = a.metadata?.direction as string | undefined
      const status = a.metadata?.status as string | undefined

      if (a.activity_type === 'call') {
        // Extract caller name from description (e.g., "Inbound call from Robert Kilgore — no-answer")
        const descParts = a.description?.split('—') || []
        const callerPart = descParts[0]?.trim() || ''
        const statusPart = descParts[1]?.trim() || status || ''

        if (direction === 'inbound') {
          // Extract just the name (remove "Inbound call from" prefix if present)
          const nameMatch = callerPart.match(/(?:Inbound call from|from)\s+(.+)/i)
          const callerName = nameMatch?.[1] || callerPart || 'Unknown'
          title = `Inbound call from ${callerName}`
        } else if (direction === 'outbound') {
          title = 'Outbound call'
        } else {
          title = 'Phone call'
        }

        // Add status as badge instead of in title
        if (statusPart) {
          // Status will be shown in the UI, not in title
        }
      } else if (a.activity_type === 'sms') {
        if (direction === 'inbound') {
          title = 'Received text message'
        } else if (direction === 'outbound') {
          title = 'Sent text message'
        }
      } else if (a.activity_type === 'voicemail') {
        title = 'New voicemail'
      }

      // For calls, extract status info and duration from description
      let statusBadge: string | undefined
      let cleanContent: string | undefined
      let dispositionLabel: string | undefined
      let dispositionTone: 'positive' | 'neutral' | 'negative' | undefined

      if (a.activity_type === 'call' && a.description) {
        const metaDuration = typeof a.metadata?.duration === 'number'
          ? (a.metadata.duration as number)
          : undefined
        const metaStatus = a.metadata?.status as string | undefined

        const fmtMMSS = (sec: number) => {
          const m = Math.floor(sec / 60)
          const s = sec % 60
          return `${m}:${String(s).padStart(2, '0')}`
        }

        if (metaDuration && metaDuration > 0) {
          statusBadge = fmtMMSS(metaDuration)
        } else if (metaStatus === 'no-answer') {
          statusBadge = 'No answer'
        } else if (metaStatus === 'busy') {
          statusBadge = 'Busy'
        } else {
          // Fallback: parse from description tail ("— 1526s" or "— completed (45s)")
          const tail = a.description.split('—')[1]?.trim()
          if (tail) {
            const m1 = tail.match(/^(\d+)s$/)
            const m2 = tail.match(/([a-z-]+)\s*\((\d+)s\)/i)
            if (m1) {
              statusBadge = fmtMMSS(parseInt(m1[1], 10))
            } else if (m2) {
              const [, callStatus, duration] = m2
              const n = parseInt(duration, 10)
              if (callStatus === 'completed' && n > 0) statusBadge = fmtMMSS(n)
              else if (callStatus === 'no-answer') statusBadge = 'No answer'
              else if (callStatus === 'busy') statusBadge = 'Busy'
              else statusBadge = callStatus
            } else {
              statusBadge = tail
            }
          }
        }

        // Show disposition notes from metadata (call dispositions save notes there)
        const callNotes = (a.metadata?.notes as string | undefined) || undefined
        cleanContent = callNotes

        // Surface disposition result as a badge
        const dispo = a.metadata?.disposition as string | undefined
        if (dispo) {
          const DISPOSITION_LABELS: Record<string, string> = {
            // current set surfaced by the disposition modal
            answered: 'Answered',
            no_answer: 'No Answer',
            left_vm: 'Left Voicemail',
            bad_number: 'Bad Number',
            busy: 'Busy',
            dnc: 'Do Not Call',
            // legacy values still present in historical rows
            spoke_with_owner: 'Answered',
            callback_requested: 'Callback Requested',
            not_interested: 'Not Interested',
            wrong_number: 'Bad Number',
            disconnected: 'Disconnected',
            deal_potential: 'Deal Potential',
            appointment_set: 'Appointment Set',
            offer_made: 'Offer Made',
            dead: 'Dead',
          }
          const POSITIVE = new Set(['answered', 'spoke_with_owner', 'callback_requested', 'deal_potential', 'appointment_set', 'offer_made'])
          const NEGATIVE = new Set(['bad_number', 'wrong_number', 'disconnected', 'dnc', 'not_interested', 'dead'])
          dispositionLabel = DISPOSITION_LABELS[dispo] || dispo.replace(/_/g, ' ')
          dispositionTone = POSITIVE.has(dispo) ? 'positive' : NEGATIVE.has(dispo) ? 'negative' : 'neutral'
        }
      } else {
        cleanContent = a.description || undefined
      }

      return {
        id: a.id,
        type: activityTypeToFeedType(a.activity_type),
        title,
        content: cleanContent,
        timestamp: a.created_at, // Pass raw ISO timestamp, let ActivityFeed format it
        statusBadge,
        dispositionLabel,
        dispositionTone,
        link,
        linkLabel,
        recordingUrl,
        rawType: a.activity_type,
        agentName: a.agent || undefined,
        metadata: a.metadata || undefined,
      }
    })

  // File checklist items
  const hasCalls = activities.some((a) => a.activity_type === 'call')
  const hasTimeline = !!lead.notes || hasCalls
  const hasCondition = !!(lead.beds || lead.sqft || lead.property_type)
  const hasMotivation = !!(lead.motivation_score || lead.seller_situation)
  const hasPrice = !!(lead.offer_amount || lead.arv)

  const checklistItems = [
    { label: 'Timeline', done: hasTimeline, icon: 'schedule', hint: 'Deadline, flexibility, life-event window' },
    { label: 'Condition', done: hasCondition, icon: 'home', hint: 'Beds/baths, sqft, repairs, occupancy' },
    { label: 'Motivation', done: hasMotivation, icon: 'psychology', hint: 'Why selling, urgency, pain points' },
    { label: 'Price', done: hasPrice, icon: 'payments', hint: 'Asking, floor, back taxes, mortgage' },
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
    <div className="lead-cockpit max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-20">
      {/* ── Cockpit Header ───────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <Link
            href="/leads"
            className="ck-icon-btn shrink-0 !w-9 !h-9"
            title="Back to leads"
          >
            <Icon name="arrow_back" size="text-base" />
          </Link>
          {/* Avatar */}
          <div className="relative shrink-0">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white font-black text-lg ring-2 shadow-lg"
              style={{
                background: 'linear-gradient(135deg, var(--ck-accent) 0%, var(--ck-accent-bright) 100%)',
                boxShadow: '0 0 0 2px rgba(239,68,68,0.3), 0 4px 16px rgba(239,68,68,0.25)',
              }}
            >
              {initials || '?'}
            </div>
          </div>
          {/* Name + meta */}
          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-center justify-start gap-2 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight truncate">
                {formattedName || 'Unknown'}
              </h1>
              <button
                onClick={() => setEditPanelOpen(true)}
                className="p-1 rounded text-[color:var(--ck-text-dim)] hover:text-white hover:bg-[color:var(--ck-surface-elev)] transition-colors"
                title="Edit lead"
              >
                <Icon name="edit" size="text-sm" />
              </button>
              <FavoriteToggle
                leadId={lead.id}
                isFavorite={lead.is_favorite ?? false}
                size="sm"
                onToggle={(val) =>
                  setLead((prev) =>
                    prev ? { ...prev, is_favorite: val, priority: val ? 'hot' : prev.priority } : prev
                  )
                }
              />
            </div>
            {addressLine && (
              <p className="mt-1.5 text-base sm:text-lg font-semibold text-white break-words text-left">
                {addressLine}
              </p>
            )}
          </div>
        </div>

        {/* Right side: action buttons ABOVE status row */}
        <div className="flex flex-col items-end gap-3 shrink-0">
          {/* Action row: icon buttons + Create Contract CTA */}
          <div className="flex items-center gap-2">
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              className="ck-icon-btn ck-icon-btn-primary"
              title="Call"
            >
              <Icon name="phone" size="text-base" />
            </a>
          )}
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              className="ck-icon-btn"
              title="Email"
            >
              <Icon name="mail" size="text-base" />
            </a>
          )}
          <button
            onClick={() => setSmsModalOpen(true)}
            className="ck-icon-btn disabled:opacity-40"
            title="Send SMS"
            disabled={!lead.phone}
          >
            <Icon name="chat_bubble" size="text-base" />
          </button>

          <div className="w-px h-8 bg-[color:var(--ck-border)] mx-1" />

          <button
            onClick={() => setNotesModalOpen(true)}
            className="h-10 px-3 sm:px-4 rounded-[10px] border border-[color:var(--ck-border)] bg-[color:var(--ck-surface-elev)] hover:bg-[color:var(--ck-surface-hi)] text-sm font-bold text-white transition-all flex items-center gap-1.5"
            title="Add note"
          >
            <Icon name="edit_note" size="text-sm" />
            <span className="hidden sm:inline">Notes</span>
          </button>
          <button
            onClick={() => setShowNewTask(true)}
            className="h-10 px-3 sm:px-4 rounded-[10px] border border-[color:var(--ck-border)] bg-[color:var(--ck-surface-elev)] hover:bg-[color:var(--ck-surface-hi)] text-sm font-bold text-white transition-all flex items-center gap-1.5"
          >
            <Icon name="add_task" size="text-sm" />
            <span className="hidden sm:inline">New Task</span>
          </button>
          <button
            onClick={() => setContractModalOpen(true)}
            className="h-10 px-3 sm:px-4 rounded-[10px] bg-[color:var(--ck-accent)] hover:bg-[color:var(--ck-accent-bright)] text-sm font-bold text-white transition-all flex items-center gap-1.5 whitespace-nowrap shadow-[0_4px_16px_rgba(239,68,68,0.25)]"
          >
            <Icon name="description" size="text-sm" />
            <span className="hidden sm:inline">Create Contract</span>
          </button>
          </div>

          {/* Status row: temperature + score + active — BELOW the action buttons */}
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <TemperatureBadge
              lead={{ priority: lead.priority, station: lead.station, created_at: lead.created_at }}
              size="sm"
              leadId={lead.id}
              onChanged={(p) => setLead((prev) => (prev ? { ...prev, priority: p } : prev))}
              clickable={true}
            />
            {(manifestScore != null || lead.motivation_score != null) && (
              <>
                <span className="text-[color:var(--ck-text-dim)]">·</span>
                <span
                  className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border flex items-center gap-1"
                  style={{
                    background: 'var(--ck-surface-elev)',
                    borderColor: 'var(--ck-border-strong)',
                    color: 'var(--ck-accent-bright)',
                  }}
                  title={manifestScore != null ? 'Qualification score' : 'Motivation score'}
                >
                  <Icon name="bolt" className="!text-[11px]" />
                  Score {manifestScore ?? lead.motivation_score}
                </span>
              </>
            )}
            <span className="text-[color:var(--ck-text-dim)]">·</span>
            <span className="text-xs font-medium text-[color:var(--ck-text-muted)]">
              {lastActivityLabel}
            </span>
            {ghostProtocolStatus && (
              <>
                <span className="text-[color:var(--ck-text-dim)]">·</span>
                <div className="px-2 py-0.5 bg-purple-500/15 border border-purple-500/40 rounded-full flex items-center gap-1">
                  <Icon name="psychology" className="!text-[11px] text-purple-300" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-purple-300">
                    Ghost · P{ghostProtocolStatus.phase}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>


      {/* 3-Column Layout */}
      <div className="grid grid-cols-12 gap-4 sm:gap-6 lg:gap-8 lg:items-start">
        {/* LEFT COLUMN: Ari Briefing, Pain Points, Seller Goals (sortable) */}
        <div className="col-span-12 lg:col-span-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-6 lg:pl-4">
          <SortableColumn
            storageKey={`crm_col_left_${id}`}
            items={[
              {
                id: 'ari-briefing',
                node: (
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
                ),
              },
              {
                id: 'pain-points',
                node: (
                  <PainPoints
                    leadId={lead.id}
                    notes={lead.notes}
                    sellerSituation={lead.seller_situation}
                    motivationScore={lead.motivation_score}
                    activities={activities}
                  />
                ),
              },
              {
                id: 'seller-goals',
                node: (
                  <SellerGoals
                    leadId={lead.id}
                    notes={lead.notes}
                    sellerSituation={lead.seller_situation}
                    activities={activities}
                  />
                ),
              },
              {
                id: 'manifest-panel',
                node: <ManifestPanel leadId={id} />,
              },
            ]}
          />
        </div>

        {/* CENTER COLUMN: Property hero + Ari chat */}
        <div className="col-span-12 lg:col-span-6 space-y-6 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-6">
          <PropertyHero
            property={property}
            zestimate={zestimate}
            redfinEstimate={redfinEstimate}
            assessedValue={assessedValue ?? lead.tax_assessment ?? null}
            taxOwed={
              manifestProperty?.taxCollector?.totalOwed ??
              manifestProperty?.taxCollector?.delinquentAmount ??
              null
            }
            estimateLoading={
              (zillowEnriching && zestimate == null) ||
              (redfinEnriching && redfinEstimate == null)
            }
            onOpenDetails={() => setDetailsExpanded(true)}
          />

          <AriChat
            leadId={lead.id}
            leadName={lead.full_name}
            attention
          />
        </div>

        {/* RIGHT COLUMN: Next Action (pinned) + sortable rest */}
        <div className="col-span-12 lg:col-span-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-6 lg:pl-4 z-0 space-y-6">
          {/* Pinned — always first, not draggable */}
          <NextAction
            leadId={lead.id}
            leadName={formattedName}
            leadPhone={lead.phone}
            leadEmail={lead.email}
            priority={lead.priority}
            station={lead.station}
            activities={activities}
            onNewTask={() => setShowNewTask(true)}
            onSmsCompose={() => { setComposeTab('sms'); setSmsModalOpen(true) }}
            onLogNote={() => setNotesModalOpen(true)}
            onAppointmentOutcome={() => setOutcomeModalOpen(true)}
            onContract={() => setContractModalOpen(true)}
            onCall={() => {
              if (lead.phone) {
                window.dispatchEvent(new CustomEvent('open-dialer', {
                  detail: { phone: lead.phone, name: formattedName, leadId: lead.id },
                }))
              }
            }}
          />

          <SortableColumn
            storageKey={`crm_col_right_v2_${id}`}
            items={[
              {
                id: 'favorite-or-fool',
                node: (
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
                    classification={(lead as any).classification}
                    priority={lead.priority}
                    isFavorite={(lead as any).is_favorite}
                    opportunityScore={(lead as any).opportunity_score}
                    activities={activities}
                  />
                ),
              },
              {
                id: 'mail-tracker',
                node: (
                  <MailTracker
                    leadId={lead.id}
                    leadName={lead.full_name ?? undefined}
                    onLogged={refreshAll}
                  />
                ),
              },
              {
                id: 'activity-feed',
                node: (
                  <ActivityFeed
                    activities={feedActivities}
                    leadPhone={lead.phone ?? undefined}
                    leadEmail={lead.email ?? undefined}
                    leadId={id}
                    onCompose={(type) => {
                      if (type === 'call') {
                        if (lead.phone) window.location.href = `tel:${lead.phone}`
                      } else if (type === 'sms') {
                        setComposeTab('sms')
                        setSmsModalOpen(true)
                      } else if (type === 'email') {
                        setComposeTab('email')
                        setSmsModalOpen(true)
                      }
                    }}
                    onEditNote={(noteId, currentContent) => {
                      setEditNoteId(noteId)
                      setEditNoteContent(currentContent)
                    }}
                    onEditTask={(taskId, currentTitle, metadata) => {
                      setEditTaskId(taskId)
                      setEditTaskTitle(currentTitle)
                      setEditTaskMetadata(metadata)
                    }}
                  />
                ),
              },
              {
                id: 'discovery-questions',
                node: (
                  <DiscoveryQuestions
                    leadId={lead.id}
                    notes={lead.notes}
                    sellerSituation={lead.seller_situation}
                    offerAmount={lead.offer_amount}
                    sqft={lead.sqft}
                    yearBuilt={lead.year_built}
                    activities={activities}
                  />
                ),
              },
              {
                id: 'net-proceeds',
                node: (
                  <div>
                    <button
                      onClick={() => setNetProceedsOpen((v) => !v)}
                      className="w-full flex items-center justify-between h-10 px-4 rounded-xl border text-xs font-bold uppercase tracking-wider transition-all"
                      style={{
                        background: 'var(--ck-surface)',
                        borderColor: 'var(--ck-border)',
                        color: 'var(--ck-text-muted)',
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <Icon name="payments" className="!text-sm !text-[color:var(--ck-accent)]" />
                        Net Proceeds
                      </span>
                      <Icon name={netProceedsOpen ? 'expand_less' : 'expand_more'} size="text-base" />
                    </button>
                    {netProceedsOpen && (
                      <div className="mt-3">
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
                      </div>
                    )}
                  </div>
                ),
              },
              {
                id: 'missing-info',
                node: <MissingInfoCard items={checklistItems} />,
              },
            ]}
          />
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
      {showNewTask && (
        <NewTaskModal
          leadId={lead.id}
          leadName={toProperCase(lead.full_name || '') || lead.property_address || 'Unknown'}
          onClose={() => setShowNewTask(false)}
          onCreated={() => { setShowNewTask(false); refreshAll() }}
        />
      )}
      {outcomeModalOpen && manifestAppointment && (
        <AppointmentOutcomeModal
          lead={lead}
          appointment={manifestAppointment}
          onClose={() => { setOutcomeModalOpen(false); setOutcomeModalDismissed(true) }}
          onSuccess={() => { refreshAll() }}
        />
      )}
      {smsModalOpen && (lead.phone || lead.email) && (
        <SmsComposeModal
          lead={lead}
          onClose={() => setSmsModalOpen(false)}
          onSent={() => { refreshAll() }}
          initialTab={composeTab}
        />
      )}
      {editNoteId && (
        <EditNoteModal
          noteId={editNoteId}
          initialContent={editNoteContent}
          onClose={() => {
            setEditNoteId(null)
            setEditNoteContent('')
          }}
          onSaved={(noteId, newContent) => {
            // Update the activity in the local state
            setActivities((prev) =>
              prev.map((a) =>
                a.id === noteId ? { ...a, description: newContent } : a
              )
            )
            refreshAll()
          }}
          onDeleted={(noteId) => {
            // Remove from local state
            setActivities((prev) => prev.filter((a) => a.id !== noteId))
            refreshAll()
          }}
        />
      )}
      {editTaskId && (
        <EditTaskModal
          taskId={editTaskId}
          initialTitle={editTaskTitle}
          initialMetadata={editTaskMetadata as Record<string, string>}
          onClose={() => {
            setEditTaskId(null)
            setEditTaskTitle('')
            setEditTaskMetadata({})
          }}
          onSaved={(taskId, newTitle, newMetadata) => {
            // Update the activity in the local state
            setActivities((prev) =>
              prev.map((a) =>
                a.id === taskId ? { ...a, description: newTitle, metadata: newMetadata } : a
              )
            )
            refreshAll()
          }}
          onDeleted={(taskId) => {
            // Remove from local state
            setActivities((prev) => prev.filter((a) => a.id !== taskId))
            refreshAll()
          }}
        />
      )}
      {notesModalOpen && (
        <>
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" onClick={() => setNotesModalOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="rounded-2xl shadow-2xl w-full max-w-lg border"
              style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
            >
              <div
                className="flex items-center justify-between px-6 py-4"
                style={{ borderBottom: '1px solid var(--ck-border)' }}
              >
                <div className="flex items-center gap-2">
                  <Icon name="edit_note" className="!text-[color:var(--ck-accent)]" />
                  <h2 className="text-lg font-bold" style={{ color: 'var(--ck-text)' }}>Add Note</h2>
                </div>
                <button
                  onClick={() => setNotesModalOpen(false)}
                  className="transition-colors"
                  style={{ color: 'var(--ck-text-muted)' }}
                >
                  <Icon name="close" />
                </button>
              </div>
              <div className="p-6">
                <AddNote
                  leadId={lead.id}
                  alwaysExpanded
                  hideHeading
                  hideCancel
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

      {/* Property details modal — opens on double-click of PropertyHero stats row */}
      <CockpitModal
        open={detailsExpanded}
        onClose={() => setDetailsExpanded(false)}
        title="Property Details"
        icon="home_work"
        size="lg"
      >
        {(() => {
          const mp = manifestProperty || {}
          const pick = <T,>(a: T | null | undefined, b: T | null | undefined): T | null =>
            (a !== null && a !== undefined ? a : (b !== null && b !== undefined ? b : null))
          return (
            <PropertyDetailsCard
              details={{
                beds: pick(lead.beds, mp.beds),
                baths_full: pick(lead.baths_full, mp.baths_full ?? mp.bathsFull),
                baths_half: pick(lead.baths_half, mp.baths_half ?? mp.bathsHalf),
                sqft: pick(lead.sqft, mp.sqft ?? mp.squareFeet),
                lot_size: pick(lead.lot_size, mp.lot_size ?? mp.lotSize),
                year_built: pick(lead.year_built, mp.year_built ?? mp.yearBuilt),
                basement_type: pick(lead.basement_type, mp.basement_type ?? mp.basement),
                stories: pick(lead.stories, mp.stories),
                garage_spaces: pick(lead.garage_spaces, mp.garage_spaces ?? mp.garage),
                roof_type: pick(lead.roof_type, mp.roof_type ?? mp.roof),
                heating: pick(lead.heating, mp.heating),
                cooling: pick(lead.cooling, mp.cooling),
                property_type: pick(lead.property_type, mp.property_type ?? mp.propertyType),
                zoning: pick(lead.zoning, mp.zoning),
                hoa_amount: pick(lead.hoa_amount, mp.hoa_amount),
                tax_assessment: pick(lead.tax_assessment, mp.assessment?.totalValue ?? mp.tax_assessment),
                tax_owed: mp.taxCollector?.totalOwed ?? mp.taxCollector?.delinquentAmount ?? null,
                first_delinquent_year: (() => {
                  const tc = mp.taxCollector || {}
                  // Prefer an explicit year field
                  const explicit =
                    tc.firstDelinquentYear ??
                    tc.firstYearDelinquent ??
                    tc.delinquentSince ??
                    tc.oldestDelinquentYear
                  if (typeof explicit === 'number' && explicit > 1900) return explicit
                  if (typeof explicit === 'string') {
                    const parsed = parseInt(explicit.slice(0, 4), 10)
                    if (parsed > 1900) return parsed
                  }
                  // Fall back to computing from yearsDelinquent
                  const yrs = tc.yearsDelinquent
                  if (typeof yrs === 'number' && yrs > 0) {
                    return new Date().getFullYear() - yrs
                  }
                  return null
                })(),
                last_sale_date: pick(lead.last_sale_date, mp.last_sale_date ?? mp.lastSaleDate),
                last_sale_price: pick(lead.last_sale_price, mp.last_sale_price ?? mp.lastSalePrice),
                data_source: pick(lead.data_source, mp.assessment?.source ?? mp.data_source),
                data_enriched_at: pick(lead.data_enriched_at, mp.assessment?.fetchedAt ?? mp.data_enriched_at),
              }}
              address={lead.property_address || undefined}
              city={lead.city || undefined}
              state={lead.state || undefined}
              zip={lead.zip || undefined}
              leadId={id}
              onEdit={() => {
                setDetailsExpanded(false)
                setEditPanelOpen(true)
              }}
            />
          )
        })()}
      </CockpitModal>
    </div>
  )
}
