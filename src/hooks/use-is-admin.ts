'use client'

import { useEffect, useState } from 'react'
import { useAuth } from './use-auth'

export function useIsAdmin() {
  const { user, loading: authLoading } = useAuth()
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!user?.email) {
      setIsAdmin(false)
      setLoading(false)
      return
    }
    let cancelled = false
    fetch(`/api/settings?email=${encodeURIComponent(user.email)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        setIsAdmin(Boolean(d?.profile?.is_admin))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [user?.email, authLoading])

  return { isAdmin, loading }
}
