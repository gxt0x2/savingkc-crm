import type { Metadata } from 'next'
import { NewsletterSignup } from '@/components/email/newsletter-signup'

export const metadata: Metadata = {
  title: 'Tuesday newsletters | Saving KC Homebuyers',
  description: 'Pick a Tuesday note from Saving KC Homebuyers: homeowners, property taxes, inherited houses, or the investor deal desk.',
}

export default function NewslettersPage() {
  return (
    <main>
      <NewsletterSignup source="newsletters-page" />
    </main>
  )
}
