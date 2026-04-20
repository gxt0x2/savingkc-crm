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
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* LEFT: hamburger + logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Hamburger — mobile only */}
            <button
              className="md:hidden p-2 text-[var(--ck-text-muted)] hover:bg-white/5 rounded-lg transition-colors"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              <Icon name="menu" size="text-xl" />
            </button>

            {/* Brand — real /logo.png with a pixel-exact SVG color-matrix filter.
                CSS `hue-rotate(180)` can't cleanly recover red (the filter matrix
                produces pink); an SVG feColorMatrix can. This one maps:
                  R' = -0.5G - 0.5B + 1    // black(0,0,0)→1; red(1,0,0)→1; white(1,1,1)→0
                  G' = -R + 1              // red(1,0,0)→0; white→0; black→1
                  B' = -R + 1              // same
                Net: black text flips to white, red stays red (brand color preserved),
                white background flips to black and disappears into the header, and
                anti-aliased mid-gray edges map to themselves so letters don't halo. */}
            <svg width="0" height="0" aria-hidden="true" className="absolute">
              <filter id="logo-dark-theme" colorInterpolationFilters="sRGB">
                <feColorMatrix
                  type="matrix"
                  values="
                    0   -0.5  -0.5  0  1
                    -1   0     0    0  1
                    -1   0     0    0  1
                    0    0     0    1  0
                  "
                />
              </filter>
            </svg>
            <Link href="/ari" className="flex items-center flex-shrink-0" aria-label="Saving KC Homebuyers">
              <img
                src="/logo.png"
                alt="Saving KC Homebuyers"
                className="h-10 w-auto"
                style={{ filter: 'url(#logo-dark-theme)' }}
              />
            </Link>
          </div>

          {/* CENTER: nav tabs (desktop only) */}
          <div className="hidden md:flex flex-1 justify-center">
            <NavTabs onNavigate={() => {}} />
          </div>

          {/* RIGHT: search, dialer, notifications, profile */}
          <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDialer(!showDialer)}
                className="relative w-10 h-10 rounded-lg bg-[#E32E2E] hover:bg-[#C42626] flex items-center justify-center transition-colors shadow-sm shadow-[#E32E2E]/30"
                aria-label="Open dialer"
                title="Open dialer"
              >
                <Icon name="call" size="text-lg" className="text-white" />
                <span className={`absolute top-1 right-1 w-2 h-2 rounded-full ring-1 ring-[#E32E2E] ${
                  dialerStatus === 'ready' || dialerStatus === 'on_call' ? 'bg-emerald-400' :
                  dialerStatus === 'connecting' || dialerStatus === 'calling' ? 'bg-amber-300' :
                  dialerStatus === 'incoming' ? 'bg-amber-300 animate-pulse' :
                  'bg-transparent ring-0'
                }`} />
              </button>
              <div className="relative" ref={profileMenuRef}>
                {profilePhotoUrl ? (
                  <button
                    onClick={() => setShowProfileMenu(!showProfileMenu)}
                    className="w-10 h-10 rounded-lg overflow-hidden bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] transition-colors"
                    aria-label="Profile menu"
                  >
                    <img
                      src={profilePhotoUrl}
                      alt="Profile"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ) : (
                  <button
                    onClick={() => setShowProfileMenu(!showProfileMenu)}
                    className="w-10 h-10 rounded-lg bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] text-[var(--ck-text)] flex items-center justify-center text-xs font-black transition-colors"
                    aria-label="Profile menu"
                  >
                    {user?.email?.substring(0, 2).toUpperCase() || 'ED'}
                  </button>
                )}
                {showProfileMenu && (
                  <div className="absolute right-0 mt-2 w-56 ck-card shadow-2xl py-2 z-50">
                    {user && (
                      <div className="px-4 py-2 border-b border-[var(--ck-border)]">
                        <p className="text-xs font-bold text-[var(--ck-text)] truncate">{user.email}</p>
                      </div>
                    )}
                    <Link
                      href="/checklist"
                      onClick={() => setShowProfileMenu(false)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[var(--ck-text)] hover:bg-white/5 transition-colors"
                    >
                      <Icon name="checklist" size="text-lg" className="text-[var(--ck-text-muted)]" /> SOD / EOD
                    </Link>
                    <Link
                      href="/settings"
                      onClick={() => setShowProfileMenu(false)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[var(--ck-text)] hover:bg-white/5 transition-colors"
                    >
                      <Icon name="settings" size="text-lg" className="text-[var(--ck-text-muted)]" /> Settings
                    </Link>
                    <button
                      onClick={() => { setShowProfileMenu(false); signOut() }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[#FCA5A5] hover:bg-[#E32E2E]/10 transition-colors"
                    >
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
