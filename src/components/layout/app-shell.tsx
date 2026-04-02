'use client'

import { useState, useEffect, useRef } from 'react'
import { NavTabs } from './nav-tab'
import { TelephonyBar } from '@/components/telephony/telephony-bar'
import { Icon } from '@/components/ui/icon'
import { useAuth } from '@/hooks/use-auth'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const { user, signOut } = useAuth()

  useEffect(() => {
    async function loadProfile() {
      if (!user?.email) return
      try {
        const res = await fetch(`/api/settings?email=${encodeURIComponent(user.email)}`)
        const data = await res.json()
        if (data.profile?.profile_photo_url) {
          setProfilePhotoUrl(data.profile.profile_photo_url)
        } else if (!data.profile) {
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
            // Retry loading profile after linking
            const res2 = await fetch(`/api/settings?email=${encodeURIComponent(user.email!)}`)
            const data2 = await res2.json()
            if (data2.profile?.profile_photo_url) {
              setProfilePhotoUrl(data2.profile.profile_photo_url)
            }
          }
        }
      } catch {}
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

            {/* Brand */}
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="Saving KC" className="h-9 w-auto" />

            </div>

            {/* Nav Tabs — desktop only */}
            <div className="hidden md:block">
              <NavTabs onNavigate={() => {}} />
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 md:gap-4">
            <form
              className="relative hidden sm:block"
              onSubmit={(e) => {
                e.preventDefault()
                const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value.trim()
                if (q) window.location.href = `/leads?q=${encodeURIComponent(q)}`
              }}
            >
              <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
                <Icon name="search" size="text-lg" />
              </span>
              <input
                name="q"
                type="text"
                className="bg-slate-100 border-none rounded-full pl-10 pr-4 py-1.5 text-sm w-48 md:w-64 focus:ring-2 focus:ring-slate-200 transition-all"
                placeholder="Search leads..."
              />
            </form>
            <div className="flex items-center gap-1">
              <button className="p-2 text-slate-500 hover:bg-slate-50 rounded-full transition-colors">
                <Icon name="notifications" />
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
      <main className="flex-1 pb-24">
        {children}
      </main>

      {/* Telephony Bar (bottom) */}
      <TelephonyBar />
    </div>
  )
}
