export const mobileConfig = {
  crmApiBaseUrl: process.env.EXPO_PUBLIC_CRM_API_BASE_URL?.replace(/\/+$/, '') ?? '',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey:
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    '',
}

export function getMissingConfig() {
  const missing: string[] = []
  if (!mobileConfig.crmApiBaseUrl) missing.push('EXPO_PUBLIC_CRM_API_BASE_URL')
  if (!mobileConfig.supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL')
  if (!mobileConfig.supabaseAnonKey) missing.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  return missing
}
