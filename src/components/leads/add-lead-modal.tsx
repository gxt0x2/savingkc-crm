'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Icon } from '@/components/ui/icon'

const SOURCE_OPTIONS = [
  'cold_call',
  'mojo_call',
  'referral',
  'direct_mail',
  'driving_for_dollars',
  'social_media',
  'website_form',
  'inbound_call',
  'inbound_sms',
  'other',
]

interface NewLead {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  zip: string | null
  county: string | null
  source: string | null
  station: string
  priority: string
  created_at: string
}

interface AddLeadModalProps {
  onClose: () => void
  onSuccess: (lead: NewLead) => void
}

export function AddLeadModal({ onClose, onSuccess }: AddLeadModalProps) {
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    property_address: '',
    city: '',
    zip: '',
    county: '',
    source: 'cold_call',

    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function setField(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    if (!form.full_name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    try {
      const supabase = createClient()
      const { data, error: dbErr } = await supabase.from('leads').insert({
        full_name: form.full_name,
        phone: form.phone || null,
        email: form.email || null,
        property_address: form.property_address || null,
        city: form.city || null,
        zip: form.zip || null,
        county: form.county || null,
        source: form.source,
        notes: form.notes || null,
        station: 'intake',
        priority: 'normal',
      }).select().single()

      if (dbErr) { setError(dbErr.message); setSaving(false); return }
      onSuccess(data as NewLead)
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-primary">Add New Lead</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
            <Icon name="close" size="text-xl" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Full Name *</label>
              <input value={form.full_name} onChange={(e) => setField('full_name', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="John Smith" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Phone</label>
              <input value={form.phone} onChange={(e) => setField('phone', e.target.value)} type="tel" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="+1 (816) 555-0000" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Email</label>
              <input value={form.email} onChange={(e) => setField('email', e.target.value)} type="email" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="john@email.com" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Property Address</label>
              <input value={form.property_address} onChange={(e) => setField('property_address', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="1234 Oak St" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">City</label>
              <input value={form.city} onChange={(e) => setField('city', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Kansas City" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Zip</label>
              <input value={form.zip} onChange={(e) => setField('zip', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="64112" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">County</label>
              <input value={form.county} onChange={(e) => setField('county', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Jackson" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Source</label>
              <select value={form.source} onChange={(e) => setField('source', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
                {SOURCE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Notes</label>
              <textarea value={form.notes} onChange={(e) => setField('notes', e.target.value)} rows={3} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" placeholder="Any additional notes..." />
            </div>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:opacity-90 transition-all disabled:opacity-60">
            {saving ? 'Saving...' : 'Save Lead'}
          </button>
        </div>
      </div>
    </div>
  )
}
