'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { useAuth } from '@/hooks/use-auth'
import { TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { GmailConnect } from '@/components/settings/gmail-connect'
import { GoogleAdsConnect } from '@/components/settings/google-ads-connect'

interface AgentProfile {
  email: string
  full_name: string
  role: 'owner' | 'agent'
  phone: string
  assigned_twilio_number: string | null
  profile_photo_url: string | null
  voicemail_greeting: string | null
  voicemail_recording_url: string | null
  after_hours_behavior: string
  notification_prefs: {
    sms: boolean
    push: boolean
    email: boolean
    new_lead: boolean
    missed_call: boolean
  }
  office_hours: {
    enabled: boolean
    start: string
    end: string
    timezone: string
  }
}

const DEFAULT_PROFILE: AgentProfile = {
  email: '',
  full_name: '',
  role: 'agent',
  phone: '',
  assigned_twilio_number: null,
  profile_photo_url: null,
  voicemail_greeting: '',
  voicemail_recording_url: null,
  after_hours_behavior: 'both',
  notification_prefs: { sms: true, push: true, email: false, new_lead: true, missed_call: true },
  office_hours: { enabled: true, start: '08:00', end: '17:00', timezone: 'America/Chicago' },
}

function formatBuildTimestamp(ts: string): string {
  if (!ts) return 'Unknown'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
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
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'
  const releaseSha = process.env.NEXT_PUBLIC_RELEASE_SHA || 'local'
  const shortSha = releaseSha === 'local' ? 'local' : releaseSha.slice(0, 7)
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || ''
  const deployEnv = (process.env.NEXT_PUBLIC_DEPLOY_ENV || 'development').toLowerCase()
  const envLabel = deployEnv === 'production' ? 'Production' : deployEnv === 'preview' ? 'Preview' : 'Development'

  const { user } = useAuth()
  const [profile, setProfile] = useState<AgentProfile>(DEFAULT_PROFILE)
  const [allProfiles, setAllProfiles] = useState<AgentProfile[]>([])
  const [selectedEmail, setSelectedEmail] = useState<string>('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  // Load all profiles (for owner agent-switcher) and current user profile
  useEffect(() => {
    if (!user?.email) return

    async function load() {
      setLoading(true)
      try {
        // Fetch all profiles
        const allRes = await fetch('/api/settings?all=true')
        const allData = await allRes.json()
        if (allData.profiles?.length) {
          setAllProfiles(allData.profiles)
        }

        // Fetch current user profile
        const res = await fetch(`/api/settings?email=${encodeURIComponent(user!.email!)}`)
        const data = await res.json()
        if (data.profile) {
          setProfile({ ...DEFAULT_PROFILE, ...data.profile })
          setSelectedEmail(user!.email!)
        } else {
          setProfile({ ...DEFAULT_PROFILE, email: user!.email! })
          setSelectedEmail(user!.email!)
        }
      } catch {}
      setLoading(false)
    }
    load()
  }, [user?.email])

  // Switch to a different agent's profile
  async function switchAgent(email: string) {
    setSelectedEmail(email)
    try {
      const res = await fetch(`/api/settings?email=${encodeURIComponent(email)}`)
      const data = await res.json()
      if (data.profile) {
        setProfile({ ...DEFAULT_PROFILE, ...data.profile })
      }
    } catch {}
  }

  function updateProfile<K extends keyof AgentProfile>(key: K, value: AgentProfile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }))
  }

  function updateNotifPref(key: string, value: boolean) {
    setProfile((prev) => ({
      ...prev,
      notification_prefs: { ...prev.notification_prefs, [key]: value },
    }))
  }

  function updateOfficeHours(key: string, value: string | boolean) {
    setProfile((prev) => ({
      ...prev,
      office_hours: { ...prev.office_hours, [key]: value },
    }))
  }

  async function save() {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: selectedEmail,
          full_name: profile.full_name,
          phone: profile.phone,
          assigned_twilio_number: profile.assigned_twilio_number,
          profile_photo_url: profile.profile_photo_url,
          voicemail_greeting: profile.voicemail_greeting,
          voicemail_recording_url: profile.voicemail_recording_url,
          after_hours_behavior: profile.after_hours_behavior,
          notification_prefs: profile.notification_prefs,
          office_hours: profile.office_hours,
        }),
      })

      const data = await res.json()

      if (res.ok && data.success) {
        setSaved(true)
        // Reload page after 500ms to show updated profile photo in header
        setTimeout(() => window.location.reload(), 500)
      } else {
        alert(`Failed to save settings: ${data.error || 'Unknown error'}`)
      }
    } catch (err: any) {
      alert(`Error saving settings: ${err.message || 'Network error'}`)
    }
  }

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const img = new Image()
    img.onload = () => {
      const MAX = 200
      let w = img.width, h = img.height
      if (w > h) { h = Math.round(h * MAX / w); w = MAX }
      else { w = Math.round(w * MAX / h); h = MAX }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      const compressed = canvas.toDataURL('image/jpeg', 0.8)
      updateProfile('profile_photo_url', compressed)
    }
    img.src = URL.createObjectURL(file)
  }

  const isOwner = allProfiles.find((p) => p.email === user?.email)?.role === 'owner'

  const initials = profile.full_name
    ? profile.full_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'NA'

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-200 rounded w-48" />
          <div className="h-64 bg-slate-100 rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-32">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-primary">Settings</h1>
        <p className="text-on-surface-variant text-sm mt-1">Configure your CRM profile and system preferences.</p>
      </div>

      <div className="space-y-8">
        {/* Gmail Sync */}
        <GmailConnect userEmail={selectedEmail || user?.email || ''} />

        {/* Company paid-media connection */}
        <GoogleAdsConnect />

        {/* Agent Switcher (Owner only) */}
        {isOwner && allProfiles.length > 1 && (
          <section className="bg-red-50 border border-red-200/40 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <Icon name="admin_panel_settings" size="text-lg" className="text-red-600" />
              <div className="flex-1">
                <label className="block text-xs font-bold text-red-700 uppercase tracking-wider mb-1">
                  Viewing Agent Profile
                </label>
                <select
                  value={selectedEmail}
                  onChange={(e) => switchAgent(e.target.value)}
                  className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  {allProfiles.map((p) => (
                    <option key={p.email} value={p.email}>
                      {p.full_name} ({p.email}) — {p.role}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        )}

        {/* Agent Profile */}
        <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
            <Icon name="person" size="text-base" /> Agent Profile
          </h2>
          <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-6 mb-6">
            <div className="relative shrink-0 mx-auto sm:mx-0">
              {profile.profile_photo_url ? (
                <img
                  src={profile.profile_photo_url}
                  alt="Profile"
                  className="w-20 h-20 sm:w-16 sm:h-16 rounded-full object-cover border-2 border-primary/20"
                />
              ) : (
                <div className="w-20 h-20 sm:w-16 sm:h-16 rounded-full bg-primary text-white flex items-center justify-center text-xl font-black">
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
              {profile.profile_photo_url && (
                <button
                  onClick={() => updateProfile('profile_photo_url', null)}
                  className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow-md"
                  title="Remove photo"
                >
                  <Icon name="close" size="text-xs" />
                </button>
              )}
            </div>
            <div className="flex-1 w-full space-y-4">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  value={profile.full_name}
                  onChange={(e) => updateProfile('full_name', e.target.value)}
                  className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Role
                </label>
                <input
                  type="text"
                  value={profile.role}
                  readOnly
                  className="w-full border border-outline-variant/10 rounded-lg px-3 py-2 text-sm bg-surface-container text-on-surface-variant cursor-not-allowed capitalize"
                />
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
                Assigned Twilio Number
              </label>
              <input
                type="text"
                value={TWILIO_NUMBERS.find((n) => n.value === profile.assigned_twilio_number)?.label || profile.assigned_twilio_number || 'Not assigned'}
                readOnly
                className="w-full border border-outline-variant/10 rounded-lg px-3 py-2 text-sm bg-surface-container text-on-surface-variant cursor-not-allowed"
              />
              <p className="text-[10px] text-on-surface-variant mt-1">Your outbound calling number shown to leads. Contact admin to change.</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Assigned Email (Outbound)
              </label>
              <input
                type="email"
                value={selectedEmail}
                readOnly
                className="w-full border border-outline-variant/10 rounded-lg px-3 py-2 text-sm bg-surface-container text-on-surface-variant cursor-not-allowed"
              />
              <p className="text-[10px] text-on-surface-variant mt-1">Your outbound email address shown to leads.</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Forwarding Number
              </label>
              <input
                type="tel"
                value={profile.phone}
                onChange={(e) => updateProfile('phone', e.target.value)}
                className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="+1 (816) 555-0100"
              />
              <p className="text-[10px] text-on-surface-variant mt-1">Inbound calls will be forwarded to this number when you&apos;re unavailable.</p>
            </div>
          </div>
        </section>

        {/* Notifications */}
        <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
            <Icon name="notifications" size="text-base" /> Notifications
          </h2>
          <div className="space-y-4">
            {([
              { key: 'sms', label: 'SMS Alerts', desc: 'Receive SMS when important events occur' },
              { key: 'email', label: 'Email Alerts', desc: 'Receive email digests and alerts' },
              { key: 'new_lead', label: 'New Lead Notification', desc: 'Alert when a new lead is added via website form' },
              { key: 'missed_call', label: 'Missed Call Alert', desc: 'Immediate SMS when a call is missed' },
            ] as const).map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{label}</div>
                  <div className="text-xs text-on-surface-variant">{desc}</div>
                </div>
                <Toggle
                  checked={!!profile.notification_prefs?.[key]}
                  onChange={(v) => updateNotifPref(key, v)}
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
              checked={!!profile.office_hours?.enabled}
              onChange={(v) => updateOfficeHours('enabled', v)}
            />
          </div>
          {profile.office_hours?.enabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Start Time
                </label>
                <input
                  type="time"
                  value={profile.office_hours?.start || '08:00'}
                  onChange={(e) => updateOfficeHours('start', e.target.value)}
                  className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  End Time
                </label>
                <input
                  type="time"
                  value={profile.office_hours?.end || '17:00'}
                  onChange={(e) => updateOfficeHours('end', e.target.value)}
                  className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
          )}
          <p className="text-xs text-on-surface-variant mt-3">
            Ari will only route calls and alerts during these hours. Outside office hours, all calls go to voicemail.
          </p>
        </section>

        {/* Voicemail Setup */}
        <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
            <Icon name="voicemail" size="text-base" /> Voicemail
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Voicemail Greeting (Text)
              </label>
              <textarea
                rows={3}
                value={profile.voicemail_greeting || ''}
                onChange={(e) => updateProfile('voicemail_greeting', e.target.value)}
                className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="You've reached [Name] with Saving KC Homebuyers..."
              />
              <p className="text-[10px] text-on-surface-variant mt-1">Text version of your greeting, stored for reference.</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                Voicemail Recording
              </label>
              {profile.voicemail_recording_url ? (
                <div className="flex items-center gap-3 p-3 bg-slate-50 border border-outline-variant/10 rounded-lg">
                  <audio controls className="flex-1 h-10">
                    <source src={profile.voicemail_recording_url} />
                  </audio>
                  <button
                    onClick={() => updateProfile('voicemail_recording_url', null)}
                    className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-3 p-4 border-2 border-dashed border-outline-variant/20 rounded-lg cursor-pointer hover:border-primary/30 hover:bg-primary/[0.02] transition-all">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon name="mic" className="text-primary" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-700">Upload voicemail recording</div>
                    <div className="text-[10px] text-on-surface-variant">MP3, WAV, or M4A up to 5MB</div>
                  </div>
                  <input
                    type="file"
                    accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file && file.size <= 5 * 1024 * 1024) {
                        const reader = new FileReader()
                        reader.onloadend = () => {
                          updateProfile('voicemail_recording_url', reader.result as string)
                        }
                        reader.readAsDataURL(file)
                      }
                    }}
                  />
                </label>
              )}
              <p className="text-[10px] text-on-surface-variant mt-1">Upload your custom voicemail greeting audio file.</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                After-Hours Behavior
              </label>
              <select
                value={profile.after_hours_behavior || 'both'}
                onChange={(e) => updateProfile('after_hours_behavior', e.target.value)}
                className="w-full border border-outline-variant/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
              >
                <option value="voicemail">Send to voicemail only</option>
                <option value="sms">Send SMS auto-response only</option>
                <option value="both">Both voicemail + SMS auto-response</option>
              </select>
            </div>
          </div>
        </section>

        {/* System Info */}
        <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-primary mb-5 flex items-center gap-2">
            <Icon name="info" size="text-base" /> System
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-on-surface-variant">CRM Version</span>
              <span className="font-semibold font-mono text-xs">v{appVersion}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Release Fingerprint</span>
              <span className="font-semibold font-mono text-xs">{shortSha}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-on-surface-variant">Build Time</span>
              <span className="font-semibold font-mono text-xs">{formatBuildTimestamp(buildTime)}</span>
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
              <span className={`inline-flex items-center gap-1 font-semibold ${deployEnv === 'production' ? 'text-secondary' : 'text-amber-500'}`}>
                <span className={`w-2 h-2 rounded-full ${deployEnv === 'production' ? 'bg-secondary' : 'bg-amber-500'}`} /> {envLabel}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Save Button */}
      <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 sm:gap-4">
        {saved && (
          <span className="text-sm text-secondary font-semibold flex items-center justify-center gap-1">
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
