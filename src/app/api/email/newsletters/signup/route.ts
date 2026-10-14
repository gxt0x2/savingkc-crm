import { createNewsletterSignupHandler } from '@/lib/email/newsletters/signup-http'
import { openEmailNewsletterStore } from '@/lib/email/newsletters/persist'

export const dynamic = 'force-dynamic'

export const POST = createNewsletterSignupHandler(openEmailNewsletterStore)
