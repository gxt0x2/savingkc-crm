import { getEnv, getRequiredEnv } from '@/lib/env-clean'

export function getSupabaseUrl(): string {
  return getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL')
}

export function getSupabasePublicKey(): string {
  return getEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
}

export function getSupabaseAdminKey(): string {
  return getEnv('SUPABASE_SECRET_KEY') || getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
}
