import type { Metadata } from 'next'
import { OauthPublicFrame } from '@/components/public/oauth-public-frame'
import styles from '@/components/public/oauth-public-frame.module.css'

export const metadata: Metadata = {
  title: 'Privacy Policy | Saving KC CRM',
  description:
    'How Saving KC CRM accesses, uses, stores, and deletes Google user data, plus SMS and contact practices for Saving KC Homebuyers LLC.',
  robots: { index: true, follow: true },
}

export default function PrivacyPage() {
  return (
    <OauthPublicFrame>
      <article className={styles.card}>
        <h1>Privacy Policy</h1>
        <p className={styles.updated}>Last updated September 20, 2026</p>

        <p>
          Saving KC Homebuyers LLC (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates{' '}
          <strong>Saving KC CRM</strong> at{' '}
          <a href="https://crm.savingkc.com">crm.savingkc.com</a>. This Privacy Policy
          describes how we collect, use, store, share, and delete personal information
          when company staff use the CRM and when we communicate with property owners.
        </p>

        <section>
          <h2>Saving KC CRM</h2>
          <p>
            Saving KC CRM is the internal operations CRM for Saving KC Homebuyers LLC.
            Staff use it to manage seller and buyer communications, appointments, pipeline
            work, and Deal Files. It is not a consumer social app or advertising product.
          </p>
        </section>

        <section>
          <h2>Google user data we access</h2>
          <p>
            When a staff user connects a Google account in Settings → Gmail Sync, we
            request only these OAuth scopes:
          </p>
          <ul>
            <li>
              <strong>gmail.readonly</strong> — read mailbox messages and metadata so the
              CRM can match inbound email to contacts and show threads on the Deal File
              and Conversations views
            </li>
            <li>
              <strong>gmail.send</strong> — send email from the connected Gmail address
              through the CRM composer
            </li>
            <li>
              <strong>calendar</strong> — create and update events on the user&apos;s
              primary Google Calendar when staff create or update CRM appointments
            </li>
            <li>
              <strong>userinfo.email</strong> and <strong>userinfo.profile</strong> —
              identify which Google account connected
            </li>
          </ul>
          <p>
            We do not request <code>mail.google.com</code> full mailbox access. We do
            not request <code>gmail.modify</code>. Inbox sync uses read-only Gmail APIs;
            outbound mail uses Gmail send; appointment writes use Google Calendar.
          </p>
        </section>

        <section>
          <h2>How we use Google user data</h2>
          <ul>
            <li>
              Provide user-facing CRM features: inbox sync, send-via-Gmail, and
              appointment write to Google Calendar
            </li>
            <li>
              Store OAuth refresh and access tokens encrypted at rest in our database
              so sync and send continue until the user disconnects
            </li>
            <li>
              Store message metadata needed to link emails to CRM contacts, and
              message content as required to display Conversations and Deal File threads
            </li>
            <li>
              Store <code>google_event_id</code> on appointments so later updates do
              not create duplicate calendar events
            </li>
          </ul>
        </section>

        <section>
          <h2>Google Limited Use commitment</h2>
          <p>
            Our use of information received from Google APIs adheres to the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              rel="noreferrer"
              target="_blank"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
          <ul>
            <li>
              We use Google user data only to provide or improve user-facing features
              that are prominent in Saving KC CRM
            </li>
            <li>We do not sell Google user data</li>
            <li>
              We do not use Google user data for advertising, retargeting, or credit
              decisions
            </li>
            <li>
              We do not transfer Google user data to third parties except (a)
              infrastructure subprocessors needed to run the CRM (hosting and
              database), (b) as required by law, or (c) with the user&apos;s explicit
              consent for a user-facing feature
            </li>
            <li>
              Humans do not read Google user mailbox contents except with the
              user&apos;s affirmative agreement for a specific message, for
              security or abuse investigation, or as required by law
            </li>
          </ul>
        </section>

        <section>
          <h2>Storage, retention, and deletion</h2>
          <ul>
            <li>
              Tokens and synced data are stored on our servers with hosting and
              database providers under contract
            </li>
            <li>
              Disconnect Gmail in Settings removes the stored OAuth tokens and stops
              further Google API access
            </li>
            <li>
              You may email{' '}
              <a href="mailto:support@savingkc.com">support@savingkc.com</a> to
              request deletion of Google-derived data associated with a connected
              account. We will delete or de-identify that data within a reasonable
              period except where we must retain records for legal or compliance
              reasons
            </li>
          </ul>
        </section>

        <section>
          <h2>Sharing</h2>
          <p>
            We do not sell, rent, or share Google user data with advertisers or data
            brokers. Limited sharing with subprocessors (hosting, database, and email
            infrastructure) occurs only to operate the CRM.
          </p>
        </section>

        <section>
          <h2>SMS communications</h2>
          <p>
            Saving KC Homebuyers may use text messaging (SMS) to communicate with
            property owners about property inquiries, offer details, appointment
            confirmations, and other service-related information. By providing a
            phone number and opting in through our website form, inbound call, or
            inbound text, you consent to receive SMS messages from Saving KC
            Homebuyers.
          </p>
          <p>
            Message frequency may vary based on inquiry activity. Standard message
            and data rates may apply. Reply STOP to opt out at any time. Reply HELP
            for assistance. Mobile numbers are not sold, rented, or shared with
            third parties for marketing or promotional purposes. We may share
            limited data with contracted providers such as Twilio solely to deliver
            communications.
          </p>
        </section>

        <section>
          <h2>Data security</h2>
          <p>
            We implement reasonable administrative, technical, and physical
            safeguards to protect client and staff information against unauthorized
            access, alteration, or disclosure.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Questions or deletion requests:{' '}
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
            Related pages:{' '}
            <a href="/product">CRM product overview</a>
            {' · '}
            <a href="/terms">Terms</a>
          </p>
        </section>
      </article>
    </OauthPublicFrame>
  )
}
