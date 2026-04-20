'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { NavTabs } from './nav-tab'
import { CommandPalette } from './command-palette'
import { DialerPanel, CallStatus } from '@/components/telephony/telephony-bar'
import { Icon } from '@/components/ui/icon'
import { useAuth } from '@/hooks/use-auth'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [showDialer, setShowDialer] = useState(false)
  const [dialerStatus, setDialerStatus] = useState<CallStatus>('offline')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const { user, signOut } = useAuth()

  // Global ⌘K / Ctrl+K to open command palette
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Auto-open dialer on incoming call
  useEffect(() => {
    if (dialerStatus === 'incoming') setShowDialer(true)
  }, [dialerStatus])

  // Listen for open-dialer custom events (from ARI page click-to-call)
  const [pendingDialLead, setPendingDialLead] = useState<{ phone: string; name: string; leadId: string } | null>(null)

  useEffect(() => {
    function handleOpenDialer(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.phone) {
        setPendingDialLead({ phone: detail.phone, name: detail.name || '', leadId: detail.leadId || '' })
        setShowDialer(true)
      }
    }
    window.addEventListener('open-dialer', handleOpenDialer)
    return () => window.removeEventListener('open-dialer', handleOpenDialer)
  }, [])

  useEffect(() => {
    async function loadProfile() {
      if (!user?.email) return
      console.log('[AppShell] Loading profile for email:', user.email)
      try {
        const res = await fetch(`/api/settings?email=${encodeURIComponent(user.email)}`)
        const data = await res.json()
        console.log('[AppShell] Profile loaded:', data.profile ? 'Found' : 'Not found')
        console.log('[AppShell] Has photo URL:', !!data.profile?.profile_photo_url)

        if (data.profile?.profile_photo_url) {
          console.log('[AppShell] Setting profile photo URL')
          setProfilePhotoUrl(data.profile.profile_photo_url)
        } else if (!data.profile) {
          console.log('[AppShell] Profile not found, attempting to link')
          // Profile not found by email — try linking Google OAuth to existing agent_profile
          const meta = (user as any).user_metadata || {}
          const linkRes = await fetch('/api/auth/link-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: user.email,
              name: meta.full_name || meta.name || '',
              phone: meta.phone || '',
            }),
          })
          if (linkRes.ok) {
            console.log('[AppShell] Profile linked, retrying load')
            // Retry loading profile after linking
            const res2 = await fetch(`/api/settings?email=${encodeURIComponent(user.email!)}`)
            const data2 = await res2.json()
            if (data2.profile?.profile_photo_url) {
              console.log('[AppShell] Setting profile photo URL after linking')
              setProfilePhotoUrl(data2.profile.profile_photo_url)
            }
          } else {
            console.log('[AppShell] Profile linking failed')
          }
        } else {
          console.log('[AppShell] Profile found but no photo URL')
        }
      } catch (err) {
        console.error('[AppShell] Error loading profile:', err)
      }
    }
    loadProfile()
  }, [user?.email])

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 w-full z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4 md:gap-8">
            {/* Hamburger — mobile only */}
            <button
              className="md:hidden p-2 text-slate-500 hover:bg-slate-50 rounded-lg transition-colors"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              <Icon name="menu" size="text-xl" />
            </button>

            {/* Brand — inline text lockup (PNG logo doesn't invert cleanly for dark) */}
            <Link href="/ari" className="flex items-center gap-2.5 group" aria-label="Saving KC home">
              <span className="w-8 h-8 rounded-lg bg-[#E32E2E] flex items-center justify-center flex-shrink-0 shadow-sm shadow-[#E32E2E]/30 group-hover:bg-[#C42626] transition-colors">
                <Icon name="home_work" size="text-lg" className="text-white" />
              </span>
              <div className="flex flex-col leading-none">
                <span className="text-white font-black text-[13px] tracking-tight">SAVING KC</span>
                <span className="text-[9px] font-bold tracking-[0.2em] text-[var(--ck-text-muted)] uppercase mt-0.5">Homebuyers</span>
              </div>
            </Link>

            {/* Nav Tabs — desktop only */}
            <div className="hidden md:block">
              <NavTabs onNavigate={() => {}} />
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 md:gap-4">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden sm:flex items-center gap-2 bg-slate-100 hover:bg-slate-200 rounded-full pl-3 pr-2 py-1.5 text-sm text-slate-500 w-48 md:w-64 transition-colors"
              aria-label="Open search"
            >
              <Icon name="search" size="text-lg" className="text-slate-400" />
              <span className="flex-1 text-left">Search leads…</span>
              <kbd className="hidden md:inline-block text-[10px] font-bold text-slate-400 bg-white border border-slate-200 rounded px-1.5 py-0.5">
                ⌘K
              </kbd>
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowDialer(!showDialer)}
                className="relative ck-icon-btn"
                aria-label="Open dialer"
                title="Open dialer"
              >
                <Icon name="call" size="text-base" className="text-[#E32E2E]" />
                <span className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
                  dialerStatus === 'ready' || dialerStatus === 'on_call' ? 'bg-emerald-400' :
                  dialerStatus === 'connecting' || dialerStatus === 'calling' ? 'bg-amber-400' :
                  dialerStatus === 'incoming' ? 'bg-amber-400 animate-pulse' :
                  'bg-[var(--ck-border-strong)]'
                }`} />
              </button>
              <button className="ck-icon-btn" aria-label="Notifications" title="Notifications">
                <Icon name="notifications" className="text-[var(--ck-text-muted)]" />
              </button>
{/* gear icon removed — settings now in profile menu only */}
              <div className="relative" ref={profileMenuRef}>
                {profilePhotoUrl ? (
                  <img
                    src={profilePhotoUrl}
                    alt="Profile"
                    className="h-8 w-8 rounded-full object-cover border border-primary/20 ml-1 cursor-pointer"
                    onClick={() => setShowProfileMenu(!showProfileMenu)}
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-primary text-white flex items-center justify-center text-[11px] font-bold ml-1 cursor-pointer" onClick={() => setShowProfileMenu(!showProfileMenu)}>
                    {user?.email?.substring(0, 2).toUpperCase() || 'ED'}
                  </div>
                )}
                {showProfileMenu && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-100 py-2 z-50">
                    {user && (
                      <div className="px-4 py-2 border-b border-slate-100">
                        <p className="text-xs font-bold text-primary truncate">{user.email}</p>
                      </div>
                    )}
                    <button onClick={() => { setShowProfileMenu(false); window.location.href = '/checklist' }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                      <Icon name="checklist" size="text-lg" /> SOD / EOD
                    </button>
                    <button onClick={() => { setShowProfileMenu(false); window.location.href = '/settings' }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                      <Icon name="settings" size="text-lg" /> Settings
                    </button>
                    <button onClick={() => { setShowProfileMenu(false); signOut() }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                      <Icon name="logout" size="text-lg" /> Sign Out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Mobile Drawer */}
      <div
        className={`fixed top-0 left-0 z-50 h-full w-72 bg-white shadow-2xl transform transition-transform duration-300 md:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 h-16 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Saving KC" className="h-9 w-auto" />

          </div>
          <button
            className="p-2 text-slate-500 hover:bg-slate-50 rounded-lg transition-colors"
            onClick={() => setDrawerOpen(false)}
          >
            <Icon name="close" size="text-xl" />
          </button>
        </div>
        <div className="p-4">
          <NavTabs onNavigate={() => setDrawerOpen(false)} mobile />
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Dialer Panel — Twilio softphone */}
      <DialerPanel
        open={showDialer}
        onClose={() => { setShowDialer(false); setPendingDialLead(null) }}
        onStatusChange={setDialerStatus}
        pendingDial={pendingDialLead}
      />

      {/* ⌘K Command Palette — global search */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
