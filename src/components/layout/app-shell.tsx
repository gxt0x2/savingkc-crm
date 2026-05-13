'use client'

import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CommandPalette } from './command-palette'
import { DialerPanel, CallStatus, HeirQueueItem } from '@/components/telephony/telephony-bar'
import { Icon } from '@/components/ui/icon'
import { useAuth } from '@/hooks/use-auth'
import { useAppMode } from '@/hooks/use-app-mode'
import { useThemePreference } from '@/hooks/use-theme-preference'
import { NotificationBell } from './notification-bell'
import { DialerCallerPlan, normalizeDialerCallerPlan } from '@/lib/dialer-caller-plan'

const NavTabs = dynamic(() => import('./nav-tab').then((mod) => mod.NavTabs), { ssr: false })
const ModeSwitcher = dynamic(() => import('./mode-switcher').then((mod) => mod.ModeSwitcher), { ssr: false })

function subscribeHydration() {
  return () => {}
}

function getClientHydrationSnapshot() {
  return true
}

function getServerHydrationSnapshot() {
  return false
}

const TC_LIGHT_THEME = {
  '--ck-bg': '#f6f7f9',
  '--ck-surface': '#ffffff',
  '--ck-surface-elev': '#f8fafc',
  '--ck-surface-hi': '#eef2f7',
  '--ck-border': '#d8dee9',
  '--ck-border-strong': '#cad2df',
  '--ck-text': '#111827',
  '--ck-text-muted': '#4b5565',
  '--ck-text-dim': '#7a8494',
  '--ck-accent': '#E32E2E',
  '--ck-accent-bright': '#c42626',
  '--ck-warn': '#f59e0b',
  '--ck-success': '#16a34a',
  '--ck-info': '#2563eb',
} as CSSProperties

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [showDialer, setShowDialer] = useState(false)
  const [dialerStatus, setDialerStatus] = useState<CallStatus>('offline')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const hydrated = useSyncExternalStore(subscribeHydration, getClientHydrationSnapshot, getServerHydrationSnapshot)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const { user, signOut } = useAuth()
  const { mode, setMode } = useAppMode()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isTcRoute = (pathname?.startsWith('/dispo/tc') ?? false) || (pathname?.startsWith('/dispo/contacts') && searchParams.get('portal') === 'tc')
  const isTcCalendar = mode === 'tc' && (pathname?.startsWith('/calendar') ?? false)
  const isTcSettings = (pathname?.startsWith('/settings') ?? false) && (mode === 'tc' || searchParams.get('portal') === 'tc')
  const useTcLightTheme = hydrated && (isTcRoute || isTcCalendar || isTcSettings)
  const { theme: userTheme, toggle: toggleTheme } = useThemePreference()
  const useUserLightTheme = hydrated && !useTcLightTheme && userTheme === 'light'
  const dialerPresentation = 'dock'

  useEffect(() => {
    const html = document.documentElement
    const body = document.body

    if (useTcLightTheme) {
      html.classList.remove('dark', 'theme-light')
      body.classList.remove('ck-dark', 'bg-background', 'text-on-surface')
      html.style.colorScheme = 'light'
      body.style.background = '#f6f7f9'
      body.style.color = '#111827'
      return
    }

    if (useUserLightTheme) {
      html.classList.remove('dark')
      html.classList.add('theme-light')
      body.classList.remove('ck-dark', 'bg-background', 'text-on-surface')
      html.style.colorScheme = 'light'
      body.style.background = '#ffffff'
      body.style.color = '#111827'
      return
    }

    html.classList.add('dark')
    html.classList.remove('theme-light')
    body.classList.add('ck-dark', 'bg-background', 'text-on-surface')
    html.style.colorScheme = 'dark'
    body.style.background = ''
    body.style.color = ''
  }, [useTcLightTheme, useUserLightTheme])

  function routeForMode(nextMode: typeof mode) {
    if (nextMode === 'dispositions') return '/dispo/pipeline'
    if (nextMode === 'tc') return '/dispo/tc'
    return '/dashboard'
  }

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

  // Listen for open-dialer custom events (from ARI page click-to-call)
  const [pendingDialLead, setPendingDialLead] = useState<{ phone: string; name: string; leadId: string; callerId?: string | null } | null>(null)
  const [pendingQueue, setPendingQueue] = useState<HeirQueueItem[] | null>(null)
  const [pendingQueueCallerId, setPendingQueueCallerId] = useState<string | null>(null)
  const [pendingQueueCallerPlan, setPendingQueueCallerPlan] = useState<DialerCallerPlan | null>(null)
  const [pendingQueueAutoDial, setPendingQueueAutoDial] = useState(false)

  function handleDialerStatusChange(status: CallStatus) {
    setDialerStatus(status)
    if (status === 'incoming') setShowDialer(true)
  }

  useEffect(() => {
    function handleOpenDialer(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.phone) {
        setPendingDialLead({
          phone: detail.phone,
          name: detail.name || '',
          leadId: detail.leadId || '',
          callerId: typeof detail.callerId === 'string' ? detail.callerId : null,
        })
        setPendingQueue(null)
        setPendingQueueCallerId(null)
        setPendingQueueCallerPlan(null)
        setPendingQueueAutoDial(false)
        setShowDialer(true)
      }
    }
    function handleOpenDialerQueue(e: Event) {
      const detail = (e as CustomEvent).detail
      if (Array.isArray(detail?.queue) && detail.queue.length > 0) {
        setPendingQueue(detail.queue)
        const callerId = typeof detail.callerId === 'string' ? detail.callerId : null
        setPendingQueueCallerId(callerId)
        setPendingQueueCallerPlan(normalizeDialerCallerPlan(detail.callerPlan, callerId || ''))
        setPendingQueueAutoDial(Boolean(detail.autoDial))
        setPendingDialLead(null)
        setShowDialer(true)
      }
    }
    window.addEventListener('open-dialer', handleOpenDialer)
    window.addEventListener('open-dialer-queue', handleOpenDialerQueue)
    return () => {
      window.removeEventListener('open-dialer', handleOpenDialer)
      window.removeEventListener('open-dialer-queue', handleOpenDialerQueue)
    }
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
          const meta = (user as { user_metadata?: { full_name?: string; name?: string; phone?: string } }).user_metadata || {}
          const linkRes = await fetch('/api/auth/link-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: user.email,
              name: meta?.full_name || meta?.name || '',
              phone: meta?.phone || '',
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
    <div
      suppressHydrationWarning
      className={`min-h-screen flex flex-col ${useTcLightTheme ? 'bg-[#f6f7f9] text-[#111827]' : 'lead-cockpit'}`}
      style={useTcLightTheme ? TC_LIGHT_THEME : undefined}
    >
      {/* Top Navbar */}
      <header
        className="sticky top-0 w-full z-40 border-b shadow-sm"
        style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* LEFT: hamburger + logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Hamburger — mobile only */}
            <button
              className="md:hidden p-2 text-[var(--ck-text-muted)] hover:bg-[var(--ck-surface-hi)] rounded-lg transition-colors"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              <Icon name="menu" size="text-xl" />
            </button>

            {/* Brand — real /logo.png with a pixel-exact SVG color-matrix filter.
                Maps black text → white, red stays red (brand), white bg disappears. */}
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
                suppressHydrationWarning
                style={useTcLightTheme ? undefined : { filter: 'url(#logo-dark-theme)' }}
              />
            </Link>

            {/* Mode Switcher — desktop only */}
            <div className="hidden md:block">
              <ModeSwitcher
                mode={mode}
                onChange={(m) => {
                  setMode(m)
                  router.push(routeForMode(m))
                }}
              />
            </div>
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
              className="hidden sm:flex items-center gap-2 rounded-full pl-3 pr-2 py-1.5 text-sm w-48 md:w-64 transition-colors text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]"
              style={{ background: 'var(--ck-surface-elev)' }}
              aria-label="Open search"
            >
              <Icon name="search" size="text-lg" className="text-[var(--ck-text-dim)]" />
              <span className="flex-1 text-left">Search leads…</span>
              <kbd
                className="hidden md:inline-block text-[10px] font-bold rounded px-1.5 py-0.5"
                style={{
                  color: 'var(--ck-text-dim)',
                  background: 'var(--ck-surface)',
                  border: '1px solid var(--ck-border)',
                }}
              >
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
              {!useTcLightTheme && (
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="w-10 h-10 rounded-lg bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] text-[var(--ck-text)] flex items-center justify-center transition-colors"
                  aria-label={userTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                  title={userTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                >
                  <Icon
                    name={userTheme === 'dark' ? 'light_mode' : 'dark_mode'}
                    size="text-lg"
                    className="text-[var(--ck-text)]"
                  />
                </button>
              )}
              <NotificationBell />
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
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[var(--ck-text)] hover:bg-[var(--ck-surface-hi)] transition-colors"
                    >
                      <Icon name="checklist" size="text-lg" className="text-[var(--ck-text-muted)]" /> SOD / EOD
                    </Link>
                    <Link
                      href={mode === 'tc' ? '/settings?portal=tc' : '/settings'}
                      onClick={() => setShowProfileMenu(false)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[var(--ck-text)] hover:bg-[var(--ck-surface-hi)] transition-colors"
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
        className={`fixed top-0 left-0 z-50 h-full w-72 shadow-2xl transform transition-transform duration-300 md:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ background: 'var(--ck-surface)' }}
      >
        <div
          className="flex items-center justify-between px-4 h-16 border-b"
          style={{ borderColor: 'var(--ck-border)' }}
        >
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Saving KC" className="h-9 w-auto" />

          </div>
          <button
            className="p-2 rounded-lg transition-colors text-[var(--ck-text-muted)] hover:bg-[var(--ck-surface-hi)]"
            onClick={() => setDrawerOpen(false)}
          >
            <Icon name="close" size="text-xl" />
          </button>
        </div>
        <div className="p-4">
          <div className="mb-4">
            <ModeSwitcher
              mode={mode}
              onChange={(m) => {
                setMode(m)
                setDrawerOpen(false)
                router.push(routeForMode(m))
              }}
            />
          </div>
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
        onClose={() => { setShowDialer(false); setPendingDialLead(null); setPendingQueue(null); setPendingQueueCallerId(null); setPendingQueueCallerPlan(null); setPendingQueueAutoDial(false) }}
        onStatusChange={handleDialerStatusChange}
        pendingDial={pendingDialLead}
        pendingQueue={pendingQueue}
        pendingQueueCallerId={pendingQueueCallerId}
        pendingQueueCallerPlan={pendingQueueCallerPlan}
        pendingQueueAutoDial={pendingQueueAutoDial}
        presentation={dialerPresentation}
      />

      {/* ⌘K Command Palette — global search */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
