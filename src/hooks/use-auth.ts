'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User, Session } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
}

// Defer Supabase browser-client creation to browser-only contexts.
// Instantiating it at hook body level ran during SSR of every page that
// mounts <AppShell> and threw "Your project's URL and API key are required"
// in the production build, crashing /ari, /dashboard, /opportunities, /calendar.
// (Same class of bug as PR #14 fixed for /login/page.tsx.)
export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
  })

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({
        user: session?.user ?? null,
        session,
        loading: false,
      })
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setState({
          user: session?.user ?? null,
          session,
          loading: false,
        })
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signOut = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }, [])

  return {
    ...state,
    signOut,
    isAuthenticated: !!state.user,
  }
}
