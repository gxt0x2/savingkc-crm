import { NextResponse } from 'next/server'
import { parseNewsletterSignup, submitNewsletterSignup, type NewsletterStore } from './signup'

export function createNewsletterSignupHandler(openStore: () => NewsletterStore) {
  return async function POST(request: Request) {
    let input: unknown
    try {
      input = await request.json()
    } catch {
      return NextResponse.json({ ok: false, error: 'Check the form and try again.' }, { status: 400 })
    }
    const parsed = parseNewsletterSignup(input, new Date())
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
    }
    let store: NewsletterStore
    try {
      store = openStore()
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Signup is not available yet. Nothing was saved.' },
        { status: 503 },
      )
    }
    const result = await submitNewsletterSignup(input, store)
    return NextResponse.json(result.body, { status: result.httpStatus })
  }
}
