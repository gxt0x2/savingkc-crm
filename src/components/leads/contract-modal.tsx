'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { toProperCase, formatPhone } from '@/lib/format'

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
  }
  onClose: () => void
  onSuccess: () => void
}

export function ContractModal({ lead, onClose, onSuccess }: ContractModalProps) {
  const mao = lead.arv ? Math.round(lead.arv * 0.7 - (lead.repair_estimate || 0)) : 0

  const [form, setForm] = useState({
    buyerEntity: 'Saving KC Homebuyers LLC',
    sellerName: toProperCase(lead.full_name),
    propertyAddress: [lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', '),
    purchasePrice: lead.offer_amount || mao || 0,
    earnestMoney: 500,
    inspectionDays: 14,
    closingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    contingencies: {
      inspection: true,
      financing: false,
      titleClear: true,
      appraisal: false,
    },
    sendSms: true,
    sendEmail: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function updateField(key: string, value: unknown) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit() {
    setSaving(true)
    setError('')

    const supabase = createClient()

    try {
      // Log activity
      await supabase.from('lead_activities').insert({
        lead_id: lead.id,
        activity_type: 'contract_sent',
        description: `Contract generated for ${form.propertyAddress}. Purchase price: $${form.purchasePrice.toLocaleString()}. Closing date: ${form.closingDate}`,
        agent: 'User',
        metadata: {
          buyer: form.buyerEntity,
          seller: form.sellerName,
          price: form.purchasePrice,
          earnest: form.earnestMoney,
          inspection_days: form.inspectionDays,
          closing_date: form.closingDate,
          contingencies: form.contingencies,
        },
      })

      // Update lead stage to negotiations if not already past it
      await supabase.from('leads').update({
        station: 'negotiations',
        offer_amount: form.purchasePrice,
      }).eq('id', lead.id)

      // Send SMS notification if enabled
      if (form.sendSms && lead.phone) {
        try {
          await fetch('/api/conversations/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              leadId: lead.id,
              to: lead.phone,
              message: `Hi ${toProperCase(lead.full_name)}, your purchase agreement from Saving KC is ready for review. We'll be sending details to your email shortly. Questions? Call us at (816) 307-7835.`,
            }),
          })
        } catch {
          console.error('SMS send failed')
        }
      }

      onSuccess()
      onClose()
    } catch (err) {
      setError('Failed to generate contract. Please try again.')
    }

    setSaving(false)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Icon name="description" className="text-primary" />
              <h2 className="text-lg font-bold text-gray-900">Generate Contract</h2>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <Icon name="close" />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Buyer */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Buying Entity</label>
              <input
                type="text"
                value={form.buyerEntity}
                onChange={(e) => updateField('buyerEntity', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
            </div>

            {/* Seller */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Seller Name(s)</label>
              <input
                type="text"
                value={form.sellerName}
                onChange={(e) => updateField('sellerName', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
            </div>

            {/* Property */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Property Address</label>
              <input
                type="text"
                value={form.propertyAddress}
                onChange={(e) => updateField('propertyAddress', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
            </div>

            {/* Price Row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Purchase Price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    value={form.purchasePrice || ''}
                    onChange={(e) => updateField('purchasePrice', parseFloat(e.target.value) || 0)}
                    className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Earnest Money</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    value={form.earnestMoney || ''}
                    onChange={(e) => updateField('earnestMoney', parseFloat(e.target.value) || 0)}
                    className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Dates Row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Inspection Period (days)</label>
                <input
                  type="number"
                  value={form.inspectionDays}
                  onChange={(e) => updateField('inspectionDays', parseInt(e.target.value) || 0)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Closing Date</label>
                <input
                  type="date"
                  value={form.closingDate}
                  onChange={(e) => updateField('closingDate', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
              </div>
            </div>

            {/* Contingencies */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Contingencies</label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(form.contingencies).map(([key, val]) => (
                  <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={val}
                      onChange={(e) => updateField('contingencies', { ...form.contingencies, [key]: e.target.checked })}
                      className="rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <span className="capitalize text-gray-700">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Notification */}
            <div className="bg-blue-50 rounded-lg p-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.sendSms}
                  onChange={(e) => updateField('sendSms', e.target.checked)}
                  className="rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className="text-gray-700">Send SMS notification to seller ({formatPhone(lead.phone)})</span>
              </label>
            </div>

            {error && <p className="text-red-600 text-sm font-medium">{error}</p>}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 border border-gray-200 rounded-lg py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex-1 bg-primary text-white rounded-lg py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Icon name="send" size="text-sm" />
                  Send Contract
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
