'use client'

import { useAuthContext } from '@/lib/auth-context'

// Keep the existing hook as the public API while the provider owns the one
// browser client and one auth-state subscription shared by the whole app.
export function useAuth() {
  return useAuthContext()
}
