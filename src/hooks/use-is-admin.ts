'use client'

import { useEffect, useState } from 'react'
import { useAuth } from './use-auth'

export function useIsAdmin() {
  const { user, loading: authLoading } = useAuth()
  const email = user?.email ?? null
  const [result, setResult] = useState<{ email: string; isAdmin: boolean } | null>(null)

  useEffect(() => {
    if (authLoading || !email) return
    let cancelled = false
    fetch(`/api/settings?email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        setResult({ email, isAdmin: Boolean(d?.profile?.is_admin) })
      })
      .catch(() => {
        if (cancelled) return
        setResult({ email, isAdmin: false })
      })
    return () => { cancelled = true }
  }, [email, authLoading])

  const hasCurrentResult = email !== null && result?.email === email
  const isAdmin = hasCurrentResult ? result.isAdmin : false
  const loading = authLoading || (email !== null && !hasCurrentResult)

  return { isAdmin, loading }
}
