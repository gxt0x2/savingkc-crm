'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface CrmSettings {
  agentName: string
  agentRole: 'owner' | 'agent'
  profilePhotoUrl: string | null
  forwardingNumber: string
  forwardingEmail: string
  smsAlerts: boolean
  emailAlerts: boolean
  newLeadNotification: boolean
  missedCallAlert: boolean
  officeHoursEnabled: boolean
  officeStart: string
  officeEnd: string
}

const DEFAULT_SETTINGS: CrmSettings = {
  agentName: 'Ernest A. Dodson III',
  agentRole: 'owner',
  profilePhotoUrl: null,
  forwardingNumber: '+18413737722',
  forwardingEmail: '',
  smsAlerts: true,
  emailAlerts: false,
  newLeadNotification: true,
  missedCallAlert: true,
  officeHoursEnabled: true,
  officeStart: '08:00',
  officeEnd: '17:00',
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-secondary' : 'bg-slate-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<CrmSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('crm_settings')
      if (stored) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) })
    } catch {}
  }, [])

  function update<K extends keyof CrmSettings>(key: K, value: CrmSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        update('profilePhotoUrl', reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  function removePhoto() {
    update('profilePhotoUrl', null)
  }

  function save() {
    localStorage.setItem('crm_settings', JSON.stringify(settings))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const initials = settings.agentName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-32">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-primary">Settings</h1>
        <p className="text-on-surface-variant text-sm mt-1">Configure your CRM profile and system preferences.</p>
      </div>

      <div className="space-y-8">
        {/* Agent Profile */}
        <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
            <Icon name="person" size="text-base" /> Agent Profile
          </h2>
          <div className="flex items-start gap-6 mb-6">
            <div className="relative shrink-0">
              {settings.profilePhotoUrl ? (
                <img
                  src={settings.profilePhotoUrl}
                  alt="Profile"
                  className="w-16 h-16 rounded-full object-cover border-2 border-primary/20"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-primary text-white flex items-center justify-center text-xl font-black">
                  {initials}
                </div>
              )}
              <label
                htmlFor="photo-upload"
                className="absolute -bottom-1 -right-1 w-7 h-7 bg-secondary text-white rounded-full flex items-center justify-center cursor-pointer hover:bg-secondary/90 transition-colors shadow-md"
              >
                <Icon name="photo_camera" size="text-sm" />
              </label>
              <input
                id="photo-upload"
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="hidden"
              />
              {settings.profilePhotoUrl && (
                <button
                  onClick={removePhoto}
                  className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow-md"
                  title="Remove photo"
                >
                  <Icon name="close" size="text-xs" />
                </button>
              )}
            </div>
            <div className="flex-1 space-y-4">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  value={settings.agentName}
                  onChange={(e) => update('agentName', e.target.value)}
                  className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Role
                </label>
                <select
                  value={settings.agentRole}
                  onChange={(e) => update('agentRole', e.target.value as 'owner' | 'agent')}
                  className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
                >
                  <option value="owner">Owner</option>
                  <option value="agent">Agent</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Communication */}
        <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
            <Icon name="call" size="text-base" /> Communication
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Forwarding Number
              </label>
              <input
                type="tel"
                value={settings.forwardingNumber}
                onChange={(e) => update('forwardingNumber', e.target.value)}
                className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="+1 (816) 555-0100"
              />
              <p className="text-[10px] text-on-surface-variant mt-1">Inbound calls will be forwarded to this number when you&apos;re unavailable.</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Assigned Twilio Number
              </label>
              <input
                type="text"
                value="+1 (816) 307-7835"
                readOnly
                className="w-full border border-outline-variant/10 rounded-lg px-3 py-2 text-sm bg-surface-container text-on-surface-variant cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Forwarding Email
              </label>
              <input
                type="email"
                value={settings.forwardingEmail}
                onChange={(e) => update('forwardingEmail', e.target.value)}
                className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="you@example.com"
              />
            </div>
          </div>
        </section>

        {/* Notifications */}
        <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
            <Icon name="notifications" size="text-base" /> Notifications
          </h2>
          <div className="space-y-4">
            {(
              [
                { key: 'smsAlerts', label: 'SMS Alerts', desc: 'Receive SMS when important events occur' },
                { key: 'emailAlerts', label: 'Email Alerts', desc: 'Receive email digests and alerts' },
                { key: 'newLeadNotification', label: 'New Lead Notification', desc: 'Alert when a new lead is added via website form' },
                { key: 'missedCallAlert', label: 'Missed Call Alert', desc: 'Immediate SMS when a call is missed' },
              ] as const
            ).map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{label}</div>
                  <div className="text-xs text-on-surface-variant">{desc}</div>
                </div>
                <Toggle
                  checked={settings[key] as boolean}
                  onChange={(v) => update(key, v)}
                />
              </div>
            ))}
          </div>
        </section>

        {/* Office Hours */}
        <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
              <Icon name="schedule" size="text-base" /> Office Hours
            </h2>
            <Toggle
              checked={settings.officeHoursEnabled}
              onChange={(v) => update('officeHoursEnabled', v)}
            />
          </div>
          {settings.officeHoursEnabled && (
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Start Time
                </label>
                <input
                  type="time"
                  value={settings.officeStart}
                  onChange={(e) => update('officeStart', e.target.value)}
                  className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  End Time
                </label>
                <input
                  type="time"
                  value={settings.officeEnd}
                  onChange={(e) => update('officeEnd', e.target.value)}
                  className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
          )}
          <p className="text-xs text-on-surface-variant mt-3">
            Ari will only route calls and alerts during these hours. Outside office hours, all calls go to voicemail.
          </p>
        </section>

        {/* System Info */}
        <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
            <Icon name="info" size="text-base" /> System
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-on-surface-variant">CRM Version</span>
              <span className="font-semibold">3.0.0 (Phase 3)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Database</span>
              <span className="font-semibold font-mono text-xs">fprrknfyzlthbxewnwmi.supabase.co</span>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Twilio Account</span>
              <span className="font-semibold">ACa20f2f747d…e7</span>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Environment</span>
              <span className="inline-flex items-center gap-1 font-semibold text-secondary">
                <span className="w-2 h-2 rounded-full bg-secondary" /> Production
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Save Button */}
      <div className="mt-8 flex items-center justify-end gap-4">
        {saved && (
          <span className="text-sm text-secondary font-semibold flex items-center gap-1">
            <Icon name="check_circle" size="text-base" /> Saved
          </span>
        )}
        <button
          onClick={save}
          className="px-8 py-3 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition-all active:scale-95"
        >
          Save Settings
        </button>
      </div>
    </div>
  )
}
