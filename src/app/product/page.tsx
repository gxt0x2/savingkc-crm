import type { Metadata } from 'next'
import Link from 'next/link'
import { OauthPublicFrame } from '@/components/public/oauth-public-frame'
import styles from '@/components/public/oauth-public-frame.module.css'

export const metadata: Metadata = {
  title: 'Saving KC CRM | Staff operations software',
  description:
    'Saving KC CRM is the internal operations platform for Saving KC Homebuyers staff: pipeline, Gmail sync and send, Google Calendar appointments, and Deal Files.',
  robots: { index: true, follow: true },
}

export default function ProductPage() {
  return (
    <OauthPublicFrame>
      <article className={styles.card}>
        <h1>Saving KC CRM</h1>
        <p className={styles.updated}>Application home page for Google OAuth reviewers and staff</p>

        <p>
          <strong>Saving KC CRM</strong> is the internal operations CRM used by
          Saving KC Homebuyers LLC at{' '}
          <a href="https://crm.savingkc.com">crm.savingkc.com</a>. Company staff
          use it to run acquisitions and dispositions work: seller and buyer
          communications, appointments, pipeline stages, and deal records. It is a
          staff tool, not a public consumer marketplace.
        </p>

        <section>
          <h2>What the product does</h2>
          <ul>
            <li>
              <strong>Pipeline and contacts</strong> — track seller and buyer
              records, stages, and next actions
            </li>
            <li>
              <strong>Gmail sync</strong> — connect a Google account so inbound
              mail can be matched to CRM contacts and shown on Conversations and
              the Deal File
            </li>
            <li>
              <strong>Gmail send</strong> — compose and send email from the
              connected Gmail address inside the CRM
            </li>
            <li>
              <strong>Google Calendar write</strong> — create and update events on
              the connected user&apos;s primary calendar when staff save CRM
              appointments
            </li>
            <li>
              <strong>Deal File</strong> — keep property, communication, and
              transaction context together for an active deal
            </li>
          </ul>
        </section>

        <section>
          <h2>Google account connection</h2>
          <p>
            Staff may optionally connect Gmail in Settings. Saving KC CRM then
            requests Gmail read, Gmail send, Google Calendar, and basic Google
            account identity. We do not request full mailbox control. Google user
            data is used only to provide these CRM features.
          </p>
          <p>
            The same Privacy Policy linked from the Google OAuth consent screen is
            published here:{' '}
            <Link href="/privacy">https://crm.savingkc.com/privacy</Link>.
          </p>
        </section>

        <section>
          <h2>Who can use it</h2>
          <p>
            Access is limited to authorized Saving KC staff. Sign-in is required
            for the working CRM. This product page, the{' '}
            <Link href="/privacy">Privacy Policy</Link>, and the{' '}
            <Link href="/terms">Terms</Link> are public so reviewers and users can
            read them without logging in.
          </p>
        </section>

        <section>
          <h2>Legal and contact</h2>
          <p>
            <Link href="/privacy">Privacy Policy</Link>
            {' · '}
            <Link href="/terms">Terms of Use</Link>
            {' · '}
            <a href="mailto:support@savingkc.com">support@savingkc.com</a>
            {' · '}
            <a href="tel:+18164292900">(816) 429-2900</a>
          </p>
          <p>
            Saving KC Homebuyers LLC · 7021 NW Winter Ave, Kansas City, MO 64152
          </p>
        </section>
      </article>
    </OauthPublicFrame>
  )
}
