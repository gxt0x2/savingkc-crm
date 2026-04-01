'use client'

import { useState, useEffect } from 'react'
import { NavTabs } from './nav-tab'
import { TelephonyBar } from '@/components/telephony/telephony-bar'
import { DialerDrawer } from '@/components/dialer/dialer-drawer'
import { Icon } from '@/components/ui/icon'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [dialerOpen, setDialerOpen] = useState(false)
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('crm_settings')
      if (stored) {
        const settings = JSON.parse(stored)
        setProfilePhotoUrl(settings.profilePhotoUrl || null)
      }
    } catch {}
  }, [])

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
            <div className="relative hidden sm:block">
              <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
                <Icon name="search" size="text-lg" />
              </span>
              <input
                type="text"
                className="bg-slate-100 border-none rounded-full pl-10 pr-4 py-1.5 text-sm w-48 md:w-64 focus:ring-2 focus:ring-slate-200 transition-all"
                placeholder="Search data..."
              />
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setDialerOpen(true)}
                className="p-2 rounded-full transition-colors bg-green-500 hover:bg-green-600 flex items-center justify-center"
                title="Open Dialer"
              >
                <Icon name="phone" className="text-white" />
              </button>
              <button className="p-2 text-slate-500 hover:bg-slate-50 rounded-full transition-colors">
                <Icon name="notifications" />
              </button>
              <button className="hidden sm:flex p-2 text-slate-500 hover:bg-slate-50 rounded-full transition-colors" onClick={() => window.location.href = '/settings'}>
                <Icon name="settings" />
              </button>
              {profilePhotoUrl ? (
                <img
                  src={profilePhotoUrl}
                  alt="Profile"
                  className="h-8 w-8 rounded-full object-cover border border-primary/20 ml-1 cursor-pointer"
                  onClick={() => window.location.href = '/settings'}
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-primary text-white flex items-center justify-center text-[11px] font-bold ml-1 cursor-pointer" onClick={() => window.location.href = '/settings'}>
                  ED
                </div>
              )}
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

      {/* Dialer Drawer */}
      <DialerDrawer isOpen={dialerOpen} onClose={() => setDialerOpen(false)} />

      {/* Main Content */}
      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}
