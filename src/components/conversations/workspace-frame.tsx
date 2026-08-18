'use client'

import Link from 'next/link'
import Image from 'next/image'
import { createContext, FormEvent, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { GlobalDialerButton } from '@/components/telephony/global-dialer-button'
import { useThemePreference } from '@/hooks/use-theme-preference'
import { conversationHubQueryKey, conversationHubStaleTime, fetchConversationHub } from '@/lib/queries/conversation-hub'
import { WorkspaceMobileNav, WorkspaceNav, workspaceLabelForPath } from './workspace-nav'
import { WorkspaceContextNav } from './workspace-context-nav'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'
import { GiraffeAssistant } from '@/components/ai/giraffe-assistant'

type WorkspaceChromeContextValue = {
  commandBarHost: HTMLDivElement | null
  setCommandBarActive: (active: boolean) => void
  setHeaderHidden: (hidden: boolean) => void
  setNeedsReplyOverride: (count: number | undefined) => void
}

const WorkspaceChromeContext = createContext<WorkspaceChromeContextValue | null>(null)

export function WorkspaceChrome({
  commandBar,
  hideHeader = false,
  needsReply,
}: {
  commandBar?: ReactNode
  hideHeader?: boolean
  needsReply?: number
}) {
  const chrome = useContext(WorkspaceChromeContext)
  const hasCommandBar = Boolean(commandBar)

  useLayoutEffect(() => {
    if (!chrome) return
    chrome.setCommandBarActive(hasCommandBar)
    chrome.setHeaderHidden(hideHeader)
    chrome.setNeedsReplyOverride(needsReply)
    return () => {
      chrome.setCommandBarActive(false)
      chrome.setHeaderHidden(false)
      chrome.setNeedsReplyOverride(undefined)
    }
  }, [chrome, hasCommandBar, hideHeader, needsReply])

  return commandBar && chrome?.commandBarHost
    ? createPortal(commandBar, chrome.commandBarHost)
    : null
}

export function WorkspaceFrame({
  children,
  needsReply,
  commandBar,
  hideHeader = false,
  userEmail,
  profilePhotoUrl,
  canReviewCalls = false,
}: {
  children: ReactNode
  needsReply?: number
  commandBar?: ReactNode
  hideHeader?: boolean
  userEmail?: string | null
  profilePhotoUrl?: string | null
  canReviewCalls?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [search, setSearch] = useState('')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [pageNeedsReply, setPageNeedsReply] = useState<number | undefined>(undefined)
  const [pageCommandBarActive, setPageCommandBarActive] = useState(false)
  const [pageHeaderHidden, setPageHeaderHidden] = useState(false)
  const [commandBarHost, setCommandBarHost] = useState<HTMLDivElement | null>(null)
  const [attentionQueryEnabled, setAttentionQueryEnabled] = useState(false)
  const { theme, toggle: toggleTheme } = useThemePreference()
  const userProfile = useMemo(() => resolveAgentTelephonyProfile(userEmail), [userEmail])
  const { data: hubPayload } = useQuery({
    queryKey: conversationHubQueryKey,
    queryFn: () => fetchConversationHub<{ attentionState?: string }>(),
    staleTime: conversationHubStaleTime,
    enabled: attentionQueryEnabled,
  })

  useEffect(() => {
    // A navigation badge must not compete with the active page for bandwidth,
    // database work, or hydration time. Load it as idle follow-up work; routes
    // that need the hub immediately use the same React Query cache key.
    const timeoutId = window.setTimeout(() => setAttentionQueryEnabled(true), 750)
    return () => window.clearTimeout(timeoutId)
  }, [])
  const hubNeedsReply = useMemo(
    () => (hubPayload?.items ?? []).filter((item) => item.attentionState === 'needs_reply').length,
    [hubPayload],
  )
  const resolvedNeedsReply = pageNeedsReply ?? needsReply ?? hubNeedsReply
  const resolvedHideHeader = pageHeaderHidden || hideHeader
  const resolvedCommandBarActive = Boolean(commandBar) || pageCommandBarActive
  const chromeContextValue = useMemo<WorkspaceChromeContextValue>(() => ({
    commandBarHost,
    setCommandBarActive: setPageCommandBarActive,
    setHeaderHidden: setPageHeaderHidden,
    setNeedsReplyOverride: setPageNeedsReply,
  }), [commandBarHost])

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const query = search.trim()
    router.push(query ? `/contacts?search=${encodeURIComponent(query)}` : '/contacts')
  }

  return (
    <div
      className="crm-workspace-shell flex h-[100dvh] overflow-hidden bg-[var(--crm-canvas)] text-[var(--crm-ink)]"
      data-theme={theme}
    >
      <WorkspaceNav needsReply={resolvedNeedsReply} userEmail={userEmail} canReviewCalls={canReviewCalls} />
      <div className="flex min-w-0 flex-1 flex-col">
        <WorkspaceChromeContext.Provider value={chromeContextValue}>
          {resolvedHideHeader ? null : <header className={`crm-shell-header flex shrink-0 flex-col border-b px-3 pb-2 pt-[max(.5rem,env(safe-area-inset-top))] backdrop-blur md:flex-row md:items-center md:gap-5 md:px-6 md:py-2 ${resolvedCommandBarActive ? 'md:min-h-[76px]' : 'md:h-[62px]'}`}>
            <div ref={setCommandBarHost} className="order-2 min-w-0 w-full md:order-1 md:flex-1">
              {commandBar ?? (pageCommandBarActive ? null : (
                <form onSubmit={submitSearch} className="relative mt-2 w-full md:mt-0 md:max-w-[610px]">
                  <span className="sr-only">Search contacts, properties, or messages</span>
                  <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-[21px] text-[var(--crm-text-muted)]" />
                  <input
                    aria-label="Search contacts, properties, or messages"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="crm-search-field h-11 w-full rounded-xl pl-12 pr-4 text-base outline-none md:h-10 md:rounded-lg md:text-sm"
                    placeholder="Search contacts, properties, or messages..."
                  />
                </form>
              ))}
            </div>
            <div className="order-1 flex h-12 w-full shrink-0 items-center gap-2 md:order-2 md:ml-auto md:h-auto md:w-auto md:gap-5">
              <Link href="/dashboard" className="mr-auto flex min-w-0 items-center gap-2 md:hidden" aria-label="Saving KC home">
                <Image src="/logo.png" alt="" width={489} height={141} className="h-7 w-10 object-contain" />
                <span className="truncate text-sm font-black text-[var(--crm-ink)]">{workspaceLabelForPath(pathname)}</span>
              </Link>
              <GlobalDialerButton />
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
              className="crm-icon-button hidden h-10 w-10 items-center justify-center rounded-lg sm:flex"
            >
              <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} className="text-[22px]" />
            </button>
            <div className="relative">
              <button type="button" onClick={() => setNotificationsOpen((value) => !value)} aria-expanded={notificationsOpen} className="crm-icon-button relative flex h-10 w-10 items-center justify-center rounded-lg text-[var(--crm-brand)]" aria-label="Notifications">
                <Icon name="notifications_none" className="text-[25px]" />
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--crm-brand)] px-1 text-[10px] font-bold text-white">{resolvedNeedsReply}</span>
              </button>
              {notificationsOpen ? <div className="crm-menu absolute right-0 top-11 z-50 w-72 overflow-hidden rounded-xl"><div className="border-b border-[var(--crm-border)] px-4 py-3 text-sm font-bold">Action center</div><Link href="/conversations" onClick={() => setNotificationsOpen(false)} className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--crm-brand-soft)]"><Icon name="forum" className="mt-0.5 text-[var(--crm-brand)]" /><span><strong className="block text-sm">{resolvedNeedsReply} conversation{resolvedNeedsReply === 1 ? '' : 's'} need a reply</strong><span className="text-xs text-[var(--crm-text-muted)]">Open the team inbox</span></span></Link><Link href="/tasks" onClick={() => setNotificationsOpen(false)} className="flex items-start gap-3 border-t border-[var(--crm-border)] px-4 py-3 hover:bg-[var(--crm-brand-soft)]"><Icon name="checklist" className="mt-0.5 text-[var(--crm-brand)]" /><span><strong className="block text-sm">Review assigned tasks</strong><span className="text-xs text-[var(--crm-text-muted)]">Open the task workspace</span></span></Link></div> : null}
            </div>
            <div className="relative">
            <button type="button" onClick={() => setProfileOpen((value) => !value)} aria-expanded={profileOpen} aria-label="Open user menu" className="flex min-h-11 items-center gap-2 rounded-lg px-1 py-1 hover:bg-[var(--crm-surface-subtle)] md:px-2">
              {profilePhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- agent profile photos are user-configured external URLs.
                <img src={profilePhotoUrl} alt={`${userProfile.displayName} profile`} className="h-9 w-9 rounded-full object-cover" />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--crm-charcoal)] text-xs font-bold text-[var(--crm-surface)]">{userProfile.initials}</div>
              )}
              <span className="hidden text-sm font-semibold text-[var(--crm-ink)] sm:inline">{userProfile.displayName}</span>
              <Icon name="expand_more" className="hidden text-[var(--crm-text-muted)] sm:inline" />
            </button>
            {profileOpen ? <div className="crm-menu absolute right-0 top-12 z-50 w-48 overflow-hidden rounded-xl py-1"><Link href="/dashboard" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold hover:bg-[var(--crm-surface-subtle)]"><Icon name="home" className="text-[18px]" />Dashboard</Link><Link href="/reports/acquisitions" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold hover:bg-[var(--crm-surface-subtle)]"><Icon name="bar_chart" className="text-[18px]" />Reports</Link><Link href="/settings" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold hover:bg-[var(--crm-surface-subtle)]"><Icon name="settings" className="text-[18px]" />Settings</Link></div> : null}
            </div>
            </div>
          </header>}
          <Suspense fallback={null}>
            <WorkspaceContextNav />
          </Suspense>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</div>
          <GiraffeAssistant />
          <WorkspaceMobileNav needsReply={resolvedNeedsReply} userEmail={userEmail} canReviewCalls={canReviewCalls} />
        </WorkspaceChromeContext.Provider>
      </div>
    </div>
  )
}
