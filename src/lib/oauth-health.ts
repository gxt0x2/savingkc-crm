import type { SupabaseClient } from '@supabase/supabase-js'

export type OAuthProvider = 'google' | 'google_ads'
export type OAuthConnectionStatus = 'connected' | 'reauthorization_required' | 'error'

export type OAuthHealth = {
  provider: OAuthProvider
  userEmail: string
  status: OAuthConnectionStatus
  errorCode: string | null
  errorMessage: string | null
  checkedAt: string
}

function healthKey(provider: OAuthProvider, userEmail: string): string {
  return `oauth_health:${provider}:${userEmail.trim().toLowerCase()}`
}

export async function readOAuthHealth(
  supabase: SupabaseClient,
  provider: OAuthProvider,
  userEmail: string,
): Promise<OAuthHealth | null> {
  const { data, error } = await supabase
    .from('system_config')
    .select('value')
    .eq('key', healthKey(provider, userEmail))
    .maybeSingle()

  if (error || data?.value == null) return null
  try {
    const parsed = JSON.parse(String(data.value)) as Partial<OAuthHealth>
    if (!parsed.status || !parsed.checkedAt) return null
    return {
      provider,
      userEmail: userEmail.trim().toLowerCase(),
      status: parsed.status,
      errorCode: parsed.errorCode || null,
      errorMessage: parsed.errorMessage || null,
      checkedAt: parsed.checkedAt,
    }
  } catch {
    return null
  }
}

export async function persistOAuthHealth(
  supabase: SupabaseClient,
  health: Omit<OAuthHealth, 'checkedAt'> & { checkedAt?: string },
): Promise<void> {
  const normalized: OAuthHealth = {
    ...health,
    userEmail: health.userEmail.trim().toLowerCase(),
    checkedAt: health.checkedAt || new Date().toISOString(),
  }
  const { error } = await supabase
    .from('system_config')
    .upsert({
      key: healthKey(normalized.provider, normalized.userEmail),
      value: JSON.stringify(normalized),
      updated_at: normalized.checkedAt,
    }, { onConflict: 'key' })

  if (error) {
    console.warn('[oauth-health] Could not persist connection health:', error.message)
  }
}

export async function markOAuthConnected(
  supabase: SupabaseClient,
  provider: OAuthProvider,
  userEmail: string,
): Promise<void> {
  await persistOAuthHealth(supabase, {
    provider,
    userEmail,
    status: 'connected',
    errorCode: null,
    errorMessage: null,
  })
}
