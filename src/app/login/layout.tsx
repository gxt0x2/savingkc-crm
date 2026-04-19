// /login imports a client Supabase factory (createBrowserClient). During
// static prerender, NEXT_PUBLIC_SUPABASE_URL isn't set in Vercel preview
// builds, causing the prerender to throw. Force-dynamic defers render
// until request time.
export const dynamic = 'force-dynamic'

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
