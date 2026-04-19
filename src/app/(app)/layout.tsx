import { AppShell } from '@/components/layout/app-shell'

// All pages under (app)/ are auth-gated and run per-request. Opt out of
// static prerendering so Next.js doesn't try to evaluate Supabase clients
// at build time (NEXT_PUBLIC_SUPABASE_* env vars aren't available in
// Preview builds, which would otherwise throw during static generation).
export const dynamic = 'force-dynamic'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
