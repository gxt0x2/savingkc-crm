import type { Metadata } from 'next'
import { NewsletterSignup } from '@/components/email/newsletter-signup'

export const metadata: Metadata = {
  title: 'Tuesday newsletters | Saving KC Homebuyers',
  description: 'Sign up for The Tuesday Note or The Tuesday Deal Desk from Saving KC Homebuyers.',
}

export default function NewslettersPage() {
  return (
    <main>
      <NewsletterSignup source="newsletters-page" />
    </main>
  )
}
