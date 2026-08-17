'use client'

import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CommandPalette } from './command-palette'
import type { CallStatus, HeirQueueItem } from '@/components/telephony/telephony-bar'
import { useAuth } from '@/hooks/use-auth'
import { useAppMode } from '@/hooks/use-app-mode'
import { useThemePreference } from '@/hooks/use-theme-preference'
import { NotificationBell } from './notification-bell'
import { DialerCallerPlan, normalizeDialerCallerPlan } from '@/lib/dialer-caller-plan'
import { WorkspaceFrame } from '@/components/conversations/workspace-frame'
import { SystemAndon } from '@/components/feedback/system-andon'
import { preloadGlobalDialer } from '@/components/telephony/global-dialer-button'
import { getServerViewedAgentEmailSnapshot, getViewedAgentEmailSnapshot, subscribeToViewedAgentChange } from '@/lib/viewed-agent-session'
import { isCaseyCrmUser } from '@/lib/telephony/agent-identity'
import { isCallReviewer } from '@/lib/call-review-reviewers'

const NavTabs = dynamic(() => import('./nav-tab').then((mod) => mod.NavTabs), { ssr: false })
const ModeSwitcher = dynamic(() => import('./mode-switcher').then((mod) => mod.ModeSwitcher), { ssr: false })
const DialerPanel = dynamic(
  () => import('@/components/telephony/telephony-bar').then((mod) => mod.DialerPanel),
  {
    ssr: false,
    loading: () => <div role="status" className="fixed bottom-5 right-5 z-[70] rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 py-3 text-xs font-black shadow-[var(--crm-shadow-lg)]">Opening phone…</div>,
  },
)

function HeaderSvg({ name, className = 'h-5 w-5' }: { name: 'menu' | 'search' | 'phone' | 'sun' | 'moon' | 'close'; className?: string }) {
  const paths = {
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    search: <path d="m15.5 15.5 4 4M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Z" />,
    phone: <path d="M7.5 4.5 10 7l-1.75 2.25a11.5 11.5 0 0 0 6.5 6.5L17 14l2.5 2.5-1 3a2 2 0 0 1-2.2 1.35C9.75 19.9 4.1 14.25 3.15 7.7A2 2 0 0 1 4.5 5.5l3-1Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
    moon: <path d="M20 14.5A7.5 7.5 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  }[name]

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {paths}
    </svg>
  )
}

function subscribeHydration() {
  return () => {}
}

function getClientHydrationSnapshot() {
  return true
}

function getServerHydrationSnapshot() {
  return false
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [showDialer, setShowDialer] = useState(false)
  const [dialerMounted, setDialerMounted] = useState(false)
  const [dialerStatus, setDialerStatus] = useState<CallStatus>('offline')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [adminReviewerEmail, setAdminReviewerEmail] = useState<string | null>(null)
  const hydrated = useSyncExternalStore(subscribeHydration, getClientHydrationSnapshot, getServerHydrationSnapshot)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const { user, signOut } = useAuth()
  const viewedAgentEmail = useSyncExternalStore(subscribeToViewedAgentChange, getViewedAgentEmailSnapshot, getServerViewedAgentEmailSnapshot)
  const { mode, setMode } = useAppMode()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isAcquisitionsCalendar =
    (pathname?.startsWith('/calendar') ?? false) &&
    (searchParams.get('department') === 'acquisitions' || (!searchParams.get('department') && mode === 'acquisitions'))
  const isAcquisitionsSettings =
    (pathname?.startsWith('/settings') ?? false) &&
    searchParams.get('portal') !== 'tc' &&
    mode !== 'tc'
  // Every dispositions route, including the TC portal, belongs to the rebuilt
  // workspace shell. Keeping TC out of this branch was the legacy-wrapper
  // exception that made the portal disappear from the new CRM experience.
  const isModernDispo = pathname?.startsWith('/dispo') ?? false
  const isConversationWorkspace =
    (pathname?.startsWith('/conversations') ?? false) ||
    (pathname?.startsWith('/my-day') ?? false) ||
    (pathname?.startsWith('/contacts') ?? false) ||
    (pathname?.startsWith('/leads') ?? false) ||
    (pathname?.startsWith('/workflows') ?? false) ||
    (pathname?.startsWith('/tasks') ?? false) ||
    (pathname?.startsWith('/reports') ?? false) ||
    (pathname?.startsWith('/ai') ?? false) ||
    (pathname?.startsWith('/ari') ?? false) ||
    (pathname?.startsWith('/opportunities') ?? false) ||
    (pathname?.startsWith('/in-closing') ?? false) ||
    (pathname?.startsWith('/dialer') ?? false) ||
    (pathname?.startsWith('/scorecard') ?? false) ||
    isAcquisitionsCalendar ||
    (pathname?.startsWith('/marketing') ?? false) ||
    isModernDispo ||
    (pathname?.startsWith('/dashboard') ?? false) ||
    isAcquisitionsSettings
  const { theme: userTheme, toggle: toggleTheme } = useThemePreference()
  const useUserLightTheme = hydrated && userTheme === 'light'
  const useLightLogo = useUserLightTheme
  // The dedicated /dialer workspace already has its own call context and
  // progress UI. Keep the softphone docked there so closing a disposition does
  // not re-open a full-screen dialer over the heir queue.
  const dialerPresentation = pathname?.startsWith('/dialer') ? 'dock' : 'modal'
  const effectiveWorkspaceEmail = pathname?.startsWith('/my-day') || pathname?.startsWith('/scorecard')
    ? 'casey@savingkc.com'
    : viewedAgentEmail || user?.email
  const shouldRedirectCaseyDashboard = pathname === '/dashboard' && isCaseyCrmUser(effectiveWorkspaceEmail)
  const signedInEmail = user?.email?.toLowerCase() ?? null
  const canReviewCalls = Boolean(signedInEmail && (isCallReviewer(signedInEmail) || adminReviewerEmail === signedInEmail))

  useEffect(() => {
    const email = signedInEmail
    if (!email) return

    if (isCallReviewer(email)) return

    let cancelled = false
    void fetch('/api/call-review/access', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : { canReviewCalls: false })
      .then((payload) => {
        if (!cancelled) setAdminReviewerEmail(payload.canReviewCalls ? email : null)
      })
      .catch(() => {
        if (!cancelled) setAdminReviewerEmail(null)
      })
    return () => { cancelled = true }
  }, [signedInEmail])

  useEffect(() => {
    if (shouldRedirectCaseyDashboard) router.replace('/my-day')
  }, [router, shouldRedirectCaseyDashboard])

  useEffect(() => {
    const html = document.documentElement
    const body = document.body

    if (useUserLightTheme) {
      html.classList.remove('dark')
      html.classList.add('theme-light')
      body.classList.remove('ck-dark', 'bg-background', 'text-on-surface')
      html.style.colorScheme = 'light'
      body.style.background = '#f5f7fa'
      body.style.color = '#0f172a'
      return
    }

    html.classList.add('dark')
    html.classList.remove('theme-light')
    body.classList.add('ck-dark', 'bg-background', 'text-on-surface')
    html.style.colorScheme = 'dark'
    body.style.background = ''
    body.style.color = ''
  }, [useUserLightTheme])

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
  const [pendingQueueRingCount, setPendingQueueRingCount] = useState<number | null>(null)

  function handleDialerStatusChange(status: CallStatus) {
    setDialerStatus(status)
    if (status === 'incoming') {
      setDialerMounted(true)
      setShowDialer(true)
    }
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
        setPendingQueueRingCount(null)
        setDialerMounted(true)
        setShowDialer(true)
      }
    }
    function handleOpenGlobalDialer() {
      setPendingDialLead(null)
      setPendingQueue(null)
      setPendingQueueCallerId(null)
      setPendingQueueCallerPlan(null)
      setPendingQueueAutoDial(false)
      setPendingQueueRingCount(null)
      setDialerMounted(true)
      setShowDialer(true)
    }
    function handleOpenDialerQueue(e: Event) {
      const detail = (e as CustomEvent).detail
      if (Array.isArray(detail?.queue) && detail.queue.length > 0) {
        setPendingQueue(detail.queue)
        const callerId = typeof detail.callerId === 'string' ? detail.callerId : null
        setPendingQueueCallerId(callerId)
        setPendingQueueCallerPlan(normalizeDialerCallerPlan(detail.callerPlan, callerId || ''))
        setPendingQueueAutoDial(Boolean(detail.autoDial))
        setPendingQueueRingCount(typeof detail.ringCount === 'number' ? detail.ringCount : null)
        setPendingDialLead(null)
        setDialerMounted(true)
        setShowDialer(true)
      }
    }
    window.addEventListener('open-dialer', handleOpenDialer)
    window.addEventListener('open-global-dialer', handleOpenGlobalDialer)
    window.addEventListener('open-dialer-queue', handleOpenDialerQueue)
    return () => {
      window.removeEventListener('open-dialer', handleOpenDialer)
      window.removeEventListener('open-global-dialer', handleOpenGlobalDialer)
      window.removeEventListener('open-dialer-queue', handleOpenDialerQueue)
    }
  }, [])

  useEffect(() => {
    async function loadProfile() {
      // The rebuilt workspace renders its signed-in identity from the auth
      // session and does not use the legacy profile-photo header. Avoid an
      // unnecessary settings request on every modern CRM first load.
      if (isConversationWorkspace || !user?.email) return
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
  }, [isConversationWorkspace, user])

  if (isConversationWorkspace) {
    return (
      <div
        className="min-h-screen bg-[var(--crm-canvas)] text-[var(--crm-ink)]"
        data-theme={userTheme}
      >
        <WorkspaceFrame userEmail={effectiveWorkspaceEmail} canReviewCalls={canReviewCalls}>
          {shouldRedirectCaseyDashboard ? (
            <div role="status" className="grid min-h-full place-items-center text-sm font-semibold text-[var(--crm-text-muted)]">
              Opening Casey’s My Day…
            </div>
          ) : children}
        </WorkspaceFrame>
        {dialerMounted ? <DialerPanel
          open={showDialer}
          onClose={() => {
            setShowDialer(false)
            setPendingDialLead(null)
            setPendingQueue(null)
            setPendingQueueCallerId(null)
            setPendingQueueCallerPlan(null)
            setPendingQueueAutoDial(false)
            setPendingQueueRingCount(null)
          }}
          onStatusChange={handleDialerStatusChange}
          pendingDial={pendingDialLead}
          pendingQueue={pendingQueue}
          pendingQueueCallerId={pendingQueueCallerId}
          pendingQueueCallerPlan={pendingQueueCallerPlan}
          pendingQueueAutoDial={pendingQueueAutoDial}
          pendingQueueRingCount={pendingQueueRingCount}
          presentation={dialerPresentation}
          signedInEmail={user?.email}
        /> : null}
      </div>
    )
  }

  return (
    <div
      suppressHydrationWarning
      className="min-h-screen flex flex-col lead-cockpit"
    >
      {/* Top Navbar */}
      <header
        className="sticky top-0 w-full z-40 border-b shadow-sm"
        style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
      >
        <div className="max-w-[1440px] mx-auto px-3 sm:px-4 lg:px-6 h-16 flex items-center justify-between gap-3">
          {/* LEFT: hamburger + logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Hamburger — mobile only */}
            <button
              className="md:hidden p-2 text-[var(--ck-text-muted)] hover:bg-[var(--ck-surface-hi)] rounded-lg transition-colors"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              <HeaderSvg name="menu" />
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
              {/* eslint-disable-next-line @next/next/no-img-element -- the active brand asset can switch between the local dark-theme file and the external light-theme source. */}
              <img
                src={useLightLogo ? 'https://savingkc.com/logo.png' : '/logo.png'}
                alt="Saving KC Homebuyers"
                className="h-10 w-auto"
                suppressHydrationWarning
                style={useLightLogo ? undefined : { filter: 'url(#logo-dark-theme)' }}
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
          <div className="hidden md:flex flex-1 justify-center min-w-0 overflow-hidden">
            <NavTabs onNavigate={() => {}} />
          </div>

          {/* RIGHT: search, dialer, notifications, profile */}
          <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden sm:flex items-center gap-2 rounded-full pl-3 pr-2 py-1.5 text-sm w-36 lg:w-48 xl:w-56 flex-shrink-0 transition-colors text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]"
              style={{ background: 'var(--ck-surface-elev)' }}
              aria-label="Open search"
            >
              <HeaderSvg name="search" className="h-5 w-5 text-[var(--ck-text-dim)]" />
              <span className="flex-1 text-left">Search leads…</span>
              <kbd
                className="hidden xl:inline-block text-[10px] font-bold rounded px-1.5 py-0.5"
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
                onClick={() => {
                  setDialerMounted(true)
                  setShowDialer((value) => !value)
                }}
                onPointerEnter={() => { void preloadGlobalDialer() }}
                onFocus={() => { void preloadGlobalDialer() }}
                className="relative w-10 h-10 rounded-lg bg-[#E32E2E] hover:bg-[#C42626] flex items-center justify-center transition-colors shadow-sm shadow-[#E32E2E]/30"
                aria-label="Open dialer"
                title="Open dialer"
              >
                <HeaderSvg name="phone" className="h-5 w-5 text-white" />
                <span className={`absolute top-1 right-1 w-2 h-2 rounded-full ring-1 ring-[#E32E2E] ${
                  dialerStatus === 'ready' || dialerStatus === 'on_call' ? 'bg-emerald-400' :
                  dialerStatus === 'connecting' || dialerStatus === 'calling' ? 'bg-amber-300' :
                  dialerStatus === 'incoming' ? 'bg-amber-300 animate-pulse' :
                  'bg-transparent ring-0'
                }`} />
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="w-10 h-10 rounded-lg bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] text-[var(--ck-text)] flex items-center justify-center transition-colors"
                aria-label={userTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                title={userTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                <HeaderSvg name={userTheme === 'dark' ? 'sun' : 'moon'} className="h-5 w-5 text-[var(--ck-text)]" />
              </button>
              <NotificationBell />
              <div className="relative" ref={profileMenuRef}>
                {profilePhotoUrl ? (
                  <button
                    onClick={() => setShowProfileMenu(!showProfileMenu)}
                    className="w-10 h-10 rounded-lg overflow-hidden bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] transition-colors"
                    aria-label="Profile menu"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- agent profile photos are user-configured external URLs. */}
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
                      SOD / EOD
                    </Link>
                    <Link
                      href={mode === 'tc' ? '/settings?portal=tc' : '/settings'}
                      onClick={() => setShowProfileMenu(false)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[var(--ck-text)] hover:bg-[var(--ck-surface-hi)] transition-colors"
                    >
                      Settings
                    </Link>
                    <button
                      onClick={() => { setShowProfileMenu(false); signOut() }}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[#FCA5A5] hover:bg-[#E32E2E]/10 transition-colors"
                    >
                      Sign Out
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
            {/* eslint-disable-next-line @next/next/no-img-element -- the compact drawer reuses the unoptimized local brand asset. */}
            <img src="/logo.png" alt="Saving KC" className="h-9 w-auto" />

          </div>
          <button
            className="p-2 rounded-lg transition-colors text-[var(--ck-text-muted)] hover:bg-[var(--ck-surface-hi)]"
            onClick={() => setDrawerOpen(false)}
          >
            <HeaderSvg name="close" />
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
      {dialerMounted ? <DialerPanel
        open={showDialer}
        onClose={() => { setShowDialer(false); setPendingDialLead(null); setPendingQueue(null); setPendingQueueCallerId(null); setPendingQueueCallerPlan(null); setPendingQueueAutoDial(false); setPendingQueueRingCount(null) }}
        onStatusChange={handleDialerStatusChange}
        pendingDial={pendingDialLead}
        pendingQueue={pendingQueue}
        pendingQueueCallerId={pendingQueueCallerId}
        pendingQueueCallerPlan={pendingQueueCallerPlan}
        pendingQueueAutoDial={pendingQueueAutoDial}
        pendingQueueRingCount={pendingQueueRingCount}
        presentation={dialerPresentation}
        signedInEmail={user?.email}
      /> : null}

      {/* ⌘K Command Palette — global search */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <SystemAndon floating />
    </div>
  )
}
