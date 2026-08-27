import { getEnv, getRequiredEnv } from '@/lib/env-clean'

export function getSupabaseUrl(): string {
  return getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL')
}

export function getSupabasePublicKey(): string {
  return getEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

function isGatewayMintedApiKey(value: string | undefined): boolean {
  return Boolean(value?.startsWith('sb_'))
}

export function getSupabaseAdminKey(): string {
  const secretKey = getEnv('SUPABASE_SECRET_KEY')
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')
  // Gateway-minted API keys get a fresh iat on every request. Prefer the
  // long-lived service-role token when it is still configured.
  if (serviceRoleKey && !isGatewayMintedApiKey(serviceRoleKey)) return serviceRoleKey
  return secretKey || getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
}
