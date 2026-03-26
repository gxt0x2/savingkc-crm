'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    // TODO: Integrate Supabase Auth
    // For now, redirect to dashboard
    window.location.href = '/dashboard'
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-white">
            <Icon name="rocket_launch" size="text-2xl" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-primary">Savings KC</h1>
            <p className="text-[10px] font-bold text-secondary uppercase tracking-widest">Acquisitions CRM</p>
          </div>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
          <h2 className="text-xl font-bold text-primary mb-1">Welcome back</h2>
          <p className="text-sm text-on-surface-variant mb-6">Sign in to your account</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20"
                placeholder="ernest@savingkc.com"
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-surface-container-low border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-white py-3 rounded-lg font-bold text-sm hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-on-surface-variant/50 mt-6">
          Powered by Ari AI Chief of Staff
        </p>
      </div>
    </div>
  )
}
