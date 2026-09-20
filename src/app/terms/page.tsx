import type { Metadata } from 'next'
import Link from 'next/link'
import { OauthPublicFrame } from '@/components/public/oauth-public-frame'
import styles from '@/components/public/oauth-public-frame.module.css'

export const metadata: Metadata = {
  title: 'Terms of Use | Saving KC CRM',
  description:
    'Terms for using Saving KC CRM software and related Saving KC Homebuyers communications, including SMS.',
  robots: { index: true, follow: true },
}

export default function TermsPage() {
  return (
    <OauthPublicFrame>
      <article className={styles.card}>
        <h1>Terms of Use</h1>
        <p className={styles.updated}>Last updated September 20, 2026</p>

        <p>
          These terms cover use of <strong>Saving KC CRM</strong> at{' '}
          <a href="https://crm.savingkc.com">crm.savingkc.com</a> and related
          communications from Saving KC Homebuyers LLC. By signing in to the CRM
          or using our websites and messaging services, you agree to these terms.
        </p>

        <section>
          <h2>Saving KC CRM software</h2>
          <p>
            Saving KC CRM is internal operations software for authorized company
            staff. Access is provided for legitimate business use only. Users must
            keep login credentials confidential, use connected Google accounts
            only for company work, and not attempt to access other users&apos;
            data or circumvent access controls.
          </p>
          <p>
            The CRM may connect to Google Gmail and Google Calendar when a user
            chooses Connect Gmail. That connection is optional, can be revoked in
            Settings, and is described in the{' '}
            <Link href="/privacy">Privacy Policy</Link>. Use of Google APIs is
            also subject to Google&apos;s terms and the Google API Services User
            Data Policy.
          </p>
          <p>
            We may suspend access for security, abuse, or employment changes. The
            software is provided for business operations; we do not warrant
            uninterrupted availability.
          </p>
        </section>

        <section>
          <h2>Real estate services</h2>
          <p>
            Saving KC Homebuyers provides real estate services to property owners
            in the Kansas City metro area, including cash offers on residential
            and land properties, assistance with inherited properties, and
            solutions for tax-delinquent real estate. We buy properties as
            principal investors and are not a licensed real estate brokerage.
          </p>
        </section>

        <section>
          <h2>Consent to receive SMS messages</h2>
          <p>
            By submitting contact information to Saving KC Homebuyers or
            requesting a property offer, you agree to receive SMS messages related
            to your property inquiry, offer details, appointment confirmations,
            and other service-related notifications.
          </p>
        </section>

        <section>
          <h2>Opt-out, frequency, and carriers</h2>
          <p>
            Reply STOP at any time to unsubscribe from SMS. After opting out you
            will no longer receive SMS updates but may still receive email or
            phone communications as part of a service relationship. Reply HELP
            for assistance. Message frequency varies with inquiry activity.
            Message and data rates may apply. Messaging is supported on major US
            carriers. Carriers are not liable for delayed or undelivered messages.
          </p>
        </section>

        <section>
          <h2>Support and contact</h2>
          <p>
            Questions about these terms:{' '}
            <a href="mailto:support@savingkc.com">support@savingkc.com</a>
            {' · '}
            <a href="tel:+18164292900">(816) 429-2900</a>
          </p>
          <p>
            Saving KC Homebuyers LLC
            <br />
            7021 NW Winter Ave
            <br />
            Kansas City, MO 64152
          </p>
          <p>
            <Link href="/product">CRM product overview</Link>
            {' · '}
            <Link href="/privacy">Privacy Policy</Link>
          </p>
        </section>
      </article>
    </OauthPublicFrame>
  )
}
