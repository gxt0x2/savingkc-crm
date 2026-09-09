import Image from 'next/image'
import { redirect } from 'next/navigation'
import { configuredCrmMcpActorEmail, isConfiguredCrmMcpActorEmail } from '@/lib/mcp/auth'
import { isAllowedCrmMcpRedirectUri } from '@/lib/mcp/oauth'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold text-primary">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-on-surface-variant">{message}</p>
      </section>
    </main>
  )
}

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>
}) {
  const authorizationId = (await searchParams).authorization_id?.trim()
  if (!authorizationId) {
    return <ErrorCard title="Invalid authorization request" message="The request is missing its authorization identifier." />
  }

  const supabase = await createClient()
  const claimsResult = await supabase.auth.getClaims()
  const email = typeof claimsResult.data?.claims?.email === 'string'
    ? claimsResult.data.claims.email.trim().toLowerCase()
    : ''

  if (claimsResult.error || !email) {
    redirect(`/login?redirect=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`)
  }

  if (!isConfiguredCrmMcpActorEmail(email)) {
    return (
      <ErrorCard
        title="This account cannot authorize CRM access"
        message={`Sign in as ${configuredCrmMcpActorEmail()} to connect the read-only SavingKC CRM tools.`}
      />
    )
  }

  const { data: authorization, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId)
  if (error || !authorization) {
    return <ErrorCard title="Authorization request expired" message="Return to Grok Bot and start the connection again." />
  }

  if (!('authorization_id' in authorization)) redirect(authorization.redirect_url)

  if (
    authorization.user.email.trim().toLowerCase() !== email ||
    !isAllowedCrmMcpRedirectUri(authorization.redirect_uri)
  ) {
    return (
      <ErrorCard
        title="Connector blocked"
        message="This request did not come from an approved Grok Bot or Cursor callback. No CRM access was granted."
      />
    )
  }

  const scopes = authorization.scope.split(/\s+/).filter(Boolean)

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image src="/logo.png" alt="Saving KC Homebuyers" width={489} height={141} sizes="194px" className="mb-3 h-14 w-auto" />
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-primary/40">Secure CRM connection</p>
        </div>

        <h1 className="text-xl font-bold text-primary">Authorize {authorization.client.name}</h1>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">
          This gives Grok Bot live, read-only access to the SavingKC CRM as {email}.
        </p>

        <div className="mt-6 rounded-xl bg-surface-container-low p-4">
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">Allowed</p>
          <p className="mt-2 text-sm text-slate-700">Read contacts, communications, tasks, workflows, operating metrics, and website-funnel summaries.</p>
          <p className="mt-4 text-xs font-black uppercase tracking-wider text-slate-500">Not allowed</p>
          <p className="mt-2 text-sm text-slate-700">Changing records, sending messages, placing calls, approving proposals, or bypassing human review.</p>
        </div>

        {scopes.length > 0 && (
          <p className="mt-4 text-xs text-slate-500">Identity scopes: {scopes.join(', ')}</p>
        )}

        <form action="/api/oauth/decision" method="POST" className="mt-7 flex gap-3">
          <input type="hidden" name="authorization_id" value={authorizationId} />
          <button type="submit" name="decision" value="approve" className="flex-1 rounded-lg bg-primary px-4 py-3 text-sm font-bold text-white hover:opacity-90">
            Allow read-only access
          </button>
          <button type="submit" name="decision" value="deny" className="rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
            Deny
          </button>
        </form>
      </section>
    </main>
  )
}
