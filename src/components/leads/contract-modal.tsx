'use client'

import { useId, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { toProperCase, formatPhone } from '@/lib/format'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'

interface ContractModalProps {
  lead: {
    id: string
    full_name: string | null
    phone: string | null
    email: string | null
    property_address: string | null
    city: string | null
    state: string | null
    zip: string | null
    arv: number | null
    offer_amount: number | null
    repair_estimate: number | null
    assignment_fee: number | null
    manifest?: {
      property?: { parcel?: string; legalDescription?: string; legal_description?: string }
    } | null
  }
  onClose: () => void
  onSuccess: () => void
}

const DEFAULT_BUYING_ENTITY = 'Saving KC Home Buyers LLC'
const DEFAULT_ESCROW_COMPANY = 'Niki Calvin'

export function ContractModal({ lead, onClose, onSuccess }: ContractModalProps) {
  const mao = lead.arv ? Math.round(lead.arv * 0.7 - (lead.repair_estimate || 0)) : 0

  const [form, setForm] = useState(() => ({
    buyerEntity: DEFAULT_BUYING_ENTITY,
    sellerName: toProperCase(lead.full_name),
    propertyAddress: [lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', '),
    parcelId: lead.manifest?.property?.parcel || '',
    legalDescription: lead.manifest?.property?.legalDescription || lead.manifest?.property?.legal_description || '',
    purchasePrice: lead.offer_amount || mao || 0,
    earnestMoney: 500,
    inspectionDays: 14,
    closingDate: new Date(new Date().setDate(new Date().getDate() + 30)).toISOString().split('T')[0],
    escrowCompany: DEFAULT_ESCROW_COMPANY,
    sendSms: false,
  }))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const titleId = useId()
  const fieldIdPrefix = useId()
  const dialogRef = useDialogAccessibility<HTMLDivElement>(true, onClose)

  function updateField(key: string, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit() {
    if (!form.propertyAddress.trim() || form.purchasePrice <= 0 || !form.closingDate) {
      setError('Property address, purchase price, and closing date are required.')
      return
    }

    setSaving(true)
    setError('')

    try {
      const supabase = createClient()
      const { error: activityError } = await supabase.from('lead_activities').insert({
        lead_id: lead.id,
        activity_type: 'contract_sent',
        description: `Contract terms recorded for ${form.propertyAddress}. Purchase price: $${form.purchasePrice.toLocaleString()}. Closing date: ${form.closingDate}`,
        agent: 'User',
        metadata: {
          buyer: form.buyerEntity,
          seller: form.sellerName,
          price: form.purchasePrice,
          earnest: form.earnestMoney,
          inspection_days: form.inspectionDays,
          closing_date: form.closingDate,
          parcel_id: form.parcelId || undefined,
          legal_description: form.legalDescription || undefined,
          escrow_company: form.escrowCompany,
        },
      })
      if (activityError) throw activityError

      const leadResponse = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: lead.id,
          offer_amount: form.purchasePrice,
        }),
      })
      if (!leadResponse.ok) {
        const payload = await leadResponse.json().catch(() => ({}))
        throw new Error(payload.error || 'Lead stage could not be updated')
      }
      const lifecycleResponse = await fetch(`/api/leads/${lead.id}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'transition',
          stage: 'offer_made',
          reason: 'Purchase terms recorded for seller review',
        }),
      })
      if (!lifecycleResponse.ok) {
        const payload = await lifecycleResponse.json().catch(() => ({}))
        throw new Error(payload.error || 'Lead stage could not be updated')
      }

      setSaved(true)
      onSuccess()

      if (form.sendSms && lead.phone) {
        const firstName = toProperCase((lead.full_name || '').split(' ')[0]) || 'there'
        const parcelLine = form.parcelId ? `\nParcel ID: ${form.parcelId}` : ''
        const legalLine = form.legalDescription
          ? `\nLegal: ${form.legalDescription.length > 120 ? form.legalDescription.slice(0, 117) + '…' : form.legalDescription}`
          : ''
        const smsBody = `Hi ${firstName}, Saving KC recorded the proposed purchase terms for your review.\nProperty: ${form.propertyAddress}${parcelLine}${legalLine}\nProposed closing via ${form.escrowCompany}. We will send the formal agreement separately. Questions? (816) 307-7835.`
        try {
          const smsResponse = await fetch('/api/conversations/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              leadId: lead.id,
              to: lead.phone,
              message: smsBody,
            }),
          })
          if (!smsResponse.ok) {
            const payload = await smsResponse.json().catch(() => ({}))
            throw new Error(payload.error || 'Seller SMS could not be sent')
          }
        } catch {
          setError('Contract terms were saved, but the seller SMS was not sent. Send it from Conversations; do not submit these terms again.')
          setSaving(false)
          return
        }
      }

      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Contract terms could not be saved. Please try again.')
    }

    setSaving(false)
  }

  const inputStyle = {
    background: 'var(--ck-surface-elev)',
    border: '1px solid var(--ck-border)',
    color: 'var(--ck-text)',
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto border"
          style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-6 py-4 border-b"
            style={{ borderColor: 'var(--ck-border)' }}
          >
            <div className="flex items-center gap-2">
              <Icon name="description" className="!text-base !text-[color:var(--ck-accent)]" />
              <div>
                <h2 id={titleId} className="text-lg font-bold" style={{ color: 'var(--ck-text)' }}>Contract Terms</h2>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--ck-text-muted)' }}>
                  Records the proposed terms. The formal agreement is generated and sent separately.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close contract dialog"
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: 'var(--ck-surface-elev)', color: 'var(--ck-text)' }}
            >
              <Icon name="close" className="!text-base" />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Buyer */}
            <Field id={`${fieldIdPrefix}-buyer`} label="Buying Entity">
              <input
                id={`${fieldIdPrefix}-buyer`}
                type="text"
                value={form.buyerEntity}
                onChange={(e) => updateField('buyerEntity', e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[color:var(--ck-accent)]"
                style={inputStyle}
              />
            </Field>

            {/* Seller */}
            <Field id={`${fieldIdPrefix}-seller`} label="Seller Name(s)">
              <input
                id={`${fieldIdPrefix}-seller`}
                type="text"
                value={form.sellerName}
                onChange={(e) => updateField('sellerName', e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[color:var(--ck-accent)]"
                style={inputStyle}
              />
            </Field>

            {/* Property */}
            <Field id={`${fieldIdPrefix}-property`} label="Property Address">
              <input
                id={`${fieldIdPrefix}-property`}
                type="text"
                value={form.propertyAddress}
                onChange={(e) => updateField('propertyAddress', e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[color:var(--ck-accent)]"
                style={inputStyle}
              />
            </Field>

            {/* Parcel ID + Escrow */}
            <div className="grid grid-cols-2 gap-3">
              <Field id={`${fieldIdPrefix}-parcel`} label="Parcel ID">
                <input
                  id={`${fieldIdPrefix}-parcel`}
                  type="text"
                  value={form.parcelId}
                  onChange={(e) => updateField('parcelId', e.target.value)}
                  placeholder="—"
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[color:var(--ck-accent)]"
                  style={inputStyle}
                />
              </Field>
              <Field id={`${fieldIdPrefix}-escrow`} label="Escrow / Title Officer">
                <input
                  id={`${fieldIdPrefix}-escrow`}
                  type="text"
                  value={form.escrowCompany}
                  onChange={(e) => updateField('escrowCompany', e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[color:var(--ck-accent)]"
                  style={inputStyle}
                />
              </Field>
            </div>

            {/* Legal Description */}
            <Field id={`${fieldIdPrefix}-legal`} label="Legal Description">
              <textarea
                id={`${fieldIdPrefix}-legal`}
                rows={2}
                value={form.legalDescription}
                onChange={(e) => updateField('legalDescription', e.target.value)}
                placeholder="Auto-pulled from manifest when available"
                className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none focus:border-[color:var(--ck-accent)]"
                style={inputStyle}
              />
            </Field>

            {/* Price Row */}
            <div className="grid grid-cols-2 gap-3">
              <Field id={`${fieldIdPrefix}-price`} label="Purchase Price">
                <div className="relative">
                  <span
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-sm"
                    style={{ color: 'var(--ck-text-dim)' }}
                  >$</span>
                  <input
                    id={`${fieldIdPrefix}-price`}
                    type="number"
                    value={form.purchasePrice || ''}
                    onChange={(e) => updateField('purchasePrice', parseFloat(e.target.value) || 0)}
                    className="w-full pl-7 pr-3 py-2 rounded-lg text-sm outline-none focus:border-[color:var(--ck-accent)]"
                    style={inputStyle}
                  />
                </div>
              </Field>
              <Field id={`${fieldIdPrefix}-earnest`} label="Earnest Money">
                <div className="relative">
                  <span
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-sm"
                    style={{ color: 'var(--ck-text-dim)' }}
                  >$</span>
                  <input
                    id={`${fieldIdPrefix}-earnest`}
                    type="number"
                    value={form.earnestMoney || ''}
                    onChange={(e) => updateField('earnestMoney', parseFloat(e.target.value) || 0)}
                    className="w-full pl-7 pr-3 py-2 rounded-lg text-sm outline-none focus:border-[color:var(--ck-accent)]"
                    style={inputStyle}
                  />
                </div>
              </Field>
            </div>

            {/* Dates Row */}
            <div className="grid grid-cols-2 gap-3">
              <Field id={`${fieldIdPrefix}-inspection`} label="Inspection Period (days)">
                <input
                  id={`${fieldIdPrefix}-inspection`}
                  type="number"
                  value={form.inspectionDays}
                  onChange={(e) => updateField('inspectionDays', parseInt(e.target.value) || 0)}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[color:var(--ck-accent)]"
                  style={inputStyle}
                />
              </Field>
              <Field id={`${fieldIdPrefix}-closing`} label="Closing Date">
                <input
                  id={`${fieldIdPrefix}-closing`}
                  type="date"
                  value={form.closingDate}
                  onChange={(e) => updateField('closingDate', e.target.value)}
                  style={inputStyle}
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:border-[color:var(--ck-accent)]"
                />
              </Field>
            </div>

            {/* Notification */}
            <label
              className="flex items-start gap-2 text-sm cursor-pointer rounded-lg p-3 border"
              style={{ background: 'var(--ck-surface-elev)', borderColor: 'var(--ck-border)' }}
            >
              <input
                type="checkbox"
                checked={form.sendSms}
                onChange={(e) => updateField('sendSms', e.target.checked)}
                className="mt-0.5 accent-[color:var(--ck-accent)]"
              />
              <span style={{ color: 'var(--ck-text)' }}>
                Notify seller by SMS after saving {lead.phone && <span style={{ color: 'var(--ck-text-muted)' }}>({formatPhone(lead.phone)})</span>} — proposed terms only; no agreement is attached
              </span>
            </label>

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
              style={{
                background: 'var(--ck-surface-elev)',
                border: '1px solid var(--ck-border)',
                color: 'var(--ck-text)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || saved}
              className="flex-1 rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              style={{ background: 'var(--ck-accent)' }}
            >
              {saving ? (
                <>
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Icon name="send" size="text-sm" />
                  Save Contract Terms
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        htmlFor={id}
        className="ck-microlabel mb-1 block !text-[10px]"
        style={{ color: 'var(--ck-text-muted)' }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}
