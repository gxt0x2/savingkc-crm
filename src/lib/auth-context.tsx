'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session, SupabaseClient, User } from '@supabase/supabase-js'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error'

export interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  error: Error | null
  status: AuthStatus
  signOut: () => Promise<void>
  retry: () => void
  isAuthenticated: boolean
}

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  error: Error | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

function toError(error: unknown) {
  return error instanceof Error ? error : new Error('Unable to load the authentication session.')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    error: null,
  })
  const [attempt, setAttempt] = useState(0)
  const clientRef = useRef<SupabaseClient | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    async function initializeAuth() {
      try {
        const { createClient } = await import('@/lib/supabase/client')
        if (cancelled) return

        const supabase = createClient()
        clientRef.current = supabase

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          (_event, session) => {
            if (cancelled) return
            setState({
              user: session?.user ?? null,
              session,
              loading: false,
              error: null,
            })
          },
        )
        unsubscribe = () => subscription.unsubscribe()

        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        if (cancelled) return

        setState({
          user: data.session?.user ?? null,
          session: data.session,
          loading: false,
          error: null,
        })
      } catch (error) {
        if (cancelled) return

        // Authentication is indeterminate here, not logged out. Preserve any
        // last known session and expose a retryable error instead of silently
        // converting an SDK/config/network failure into an anonymous user.
        setState((current) => ({
          ...current,
          loading: false,
          error: toError(error),
        }))
      }
    }

    void initializeAuth()

    return () => {
      cancelled = true
      unsubscribe?.()
      clientRef.current = null
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }))
    setAttempt((current) => current + 1)
  }, [])

  const signOut = useCallback(async () => {
    try {
      let supabase = clientRef.current
      if (!supabase) {
        const { createClient } = await import('@/lib/supabase/client')
        supabase = createClient()
        clientRef.current = supabase
      }

      // Preserve the previous hook contract: completing the sign-out request
      // returns the user to login even when Supabase reports a remote-session
      // cleanup error. Import/client failures still reject and remain retryable.
      await supabase.auth.signOut()
      window.location.href = '/login'
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: toError(error),
      }))
      throw error
    }
  }, [])

  const value = useMemo<AuthContextValue>(() => {
    const status: AuthStatus = state.loading
      ? 'loading'
      : state.error
        ? 'error'
        : state.user
          ? 'authenticated'
          : 'unauthenticated'

    return {
      ...state,
      status,
      signOut,
      retry,
      isAuthenticated: Boolean(state.user),
    }
  }, [retry, signOut, state])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthContext() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.')
  }
  return context
}
