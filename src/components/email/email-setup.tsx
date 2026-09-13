import { useState, type FormEvent } from 'react'
import type { EmailCommand } from '@/lib/email/contracts'
import type { EmailWorkspaceConfig } from '@/lib/email/config'
import type { PilotSettings } from '@/lib/email/workflow/types'
import styles from './email-workspace.module.css'
import { EmailConnections } from './email-connections'

type Props = {
  settings: PilotSettings
  busy: boolean
  act(command: EmailCommand): Promise<unknown>
}
const weekdays: NonNullable<EmailWorkspaceConfig['team']>['hours']['weekdays'] =
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

function BusinessForm({ settings, busy, act }: Props) {
  const [form, setForm] = useState<
    NonNullable<EmailWorkspaceConfig['business']>
  >(
    settings.config.business ?? {
      name: '',
      address: '',
      primaryDomain: '',
      timezone: 'America/Chicago',
      programs: ['seller_outreach'],
      contact: '',
      privacyUrl: '',
    },
  )
  async function save(event: FormEvent) {
    event.preventDefault()
    await act({
      command: 'SET-BUSINESS',
      idempotencyKey: crypto.randomUUID(),
      expectedRevision: settings.revision,
      payload: form,
    })
  }
  return (
    <form className={styles.form} onSubmit={save} aria-label="Business details">
      <h3>Business details</h3>
      <p>
        Use the business identity readers should see. Sender domains are
        connected separately.
      </p>
      <div className={styles.setupGrid}>
        <label>
          Business name
          <input
            required
            maxLength={200}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          Main company domain
          <input
            required
            placeholder="savingkc.com"
            maxLength={253}
            value={form.primaryDomain}
            onChange={(e) =>
              setForm({ ...form, primaryDomain: e.target.value })
            }
          />
        </label>
        <label>
          Business mailing address
          <textarea
            required
            maxLength={1000}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </label>
        <label>
          Contact shown to readers
          <input
            required
            maxLength={500}
            value={form.contact}
            onChange={(e) => setForm({ ...form, contact: e.target.value })}
          />
        </label>
        <label>
          Privacy page URL
          <input
            type="url"
            required
            placeholder="https://…"
            maxLength={2000}
            value={form.privacyUrl}
            onChange={(e) => setForm({ ...form, privacyUrl: e.target.value })}
          />
        </label>
        <label>
          Business timezone
          <input readOnly value="Central · America/Chicago" />
        </label>
      </div>
      <p>
        Current program: seller outreach. These details are saved
        locally; this step does not connect a sender or start a campaign.
      </p>
      <button className={styles.primary} disabled={busy}>
        Save business details
      </button>
    </form>
  )
}
function TeamForm({ settings, busy, act }: Props) {
  const [form, setForm] = useState<NonNullable<EmailWorkspaceConfig['team']>>(
    settings.config.team ?? {
      reviewerId: '',
      acquisitionOwnerId: '',
      backupId: '',
      hours: {
        timezone: 'America/Chicago',
        weekdays,
        startLocal: '09:00',
        endLocal: '17:00',
      },
      sla: { urgentMinutes: 15, ordinaryMinutes: 120 },
      calendarMode: 'manual',
    },
  )
  const members = settings.members.filter((m) => m.active && m.crm_active)
  return (
    <form
      className={styles.form}
      aria-label="Team responsibilities"
      onSubmit={async (event) => {
        event.preventDefault()
        await act({
          command: 'SET-TEAM',
          idempotencyKey: crypto.randomUUID(),
          expectedRevision: settings.revision,
          payload: form,
        })
      }}
    >
      <h3>Team responsibilities</h3>
      <p>
        Choose who reviews replies, who handles seller conversations and a
        different person as backup.
      </p>
      <div className={styles.setupGrid}>
        {(['reviewerId', 'acquisitionOwnerId', 'backupId'] as const).map(
          (field) => (
            <label key={field} htmlFor={`email-setup-${field}`}>
              {
                {
                  reviewerId: 'Reply reviewer',
                  acquisitionOwnerId: 'Acquisitions owner',
                  backupId: 'Backup agent',
                }[field]
              }
              <select
                id={`email-setup-${field}`}
                required
                value={form[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              >
                <option value="">Choose a team member</option>
                {members
                  .filter(
                    (m) =>
                      m.roles.includes('owner') ||
                      m.roles.includes(
                        field === 'reviewerId' ? 'reviewer' : 'acquisitions',
                      ),
                  )
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
          ),
        )}
        <label>
          Weekday start · Central
          <input
            type="time"
            required
            min="08:30"
            value={form.hours.startLocal}
            onChange={(e) =>
              setForm({
                ...form,
                hours: { ...form.hours, startLocal: e.target.value },
              })
            }
          />
        </label>
        <label>
          Weekday end · Central
          <input
            type="time"
            required
            value={form.hours.endLocal}
            onChange={(e) =>
              setForm({
                ...form,
                hours: { ...form.hours, endLocal: e.target.value },
              })
            }
          />
        </label>
        <label>
          Urgent reply target · minutes
          <input
            type="number"
            required
            min="1"
            max="1440"
            value={form.sla.urgentMinutes}
            onChange={(e) =>
              setForm({
                ...form,
                sla: { ...form.sla, urgentMinutes: Number(e.target.value) },
              })
            }
          />
        </label>
        <label>
          Ordinary reply target · minutes
          <input
            type="number"
            required
            min="1"
            max="10080"
            value={form.sla.ordinaryMinutes}
            onChange={(e) =>
              setForm({
                ...form,
                sla: { ...form.sla, ordinaryMinutes: Number(e.target.value) },
              })
            }
          />
        </label>
      </div>
      <p>
        Monday–Friday. Calendar bookings remain manual until Google Calendar is
        connected. The acquisition owner and backup prefill callback handoffs.
        Reply-review routing and timed escalation are still being built.
      </p>
      <button className={styles.primary} disabled={busy}>
        Save team responsibilities
      </button>
    </form>
  )
}
function MemberForm({
  member,
  busy,
  act,
}: {
  member: PilotSettings['members'][number]
  busy: boolean
  act: Props['act']
}) {
  const [roles, setRoles] = useState(member.roles)
  const [active, setActive] = useState(member.active)
  return (
    <form
      className={styles.memberForm}
      onSubmit={async (event) => {
        event.preventDefault()
        await act({
          command: 'SET-ROLES',
          idempotencyKey: crypto.randomUUID(),
          expectedRevision: member.revision,
          payload: {
            authUserId: member.id,
            roles: roles as Extract<
              EmailCommand,
              { command: 'SET-ROLES' }
            >['payload']['roles'],
            active,
            affectedWorkHash: member.affectedWorkHash,
          },
        })
      }}
    >
      <fieldset disabled={busy}>
        <legend>{member.name}</legend>
        <p>
          {member.affectedThreads} conversation
          {member.affectedThreads === 1 ? '' : 's'} may need review if access is
          reduced. Pending messages will be cancelled and owners notified.
        </p>
        <div className={styles.roleChoices}>
          {['owner', 'marketer', 'reviewer', 'acquisitions', 'reader'].map(
            (role) => (
              <label key={role}>
                <input
                  type="checkbox"
                  checked={roles.includes(role)}
                  onChange={(e) =>
                    setRoles(
                      e.target.checked
                        ? [...roles, role]
                        : roles.filter((r) => r !== role),
                    )
                  }
                />
                {role}
              </label>
            ),
          )}
          <label>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active in Email
          </label>
        </div>
        {!member.crm_active && (
          <p>
            CRM account is inactive. It must be reactivated in the CRM before
            Email access can be enabled.
          </p>
        )}
        <button disabled={busy || !roles.length}>
          Save access for {member.name}
        </button>
      </fieldset>
    </form>
  )
}

export function EmailSetup(props: Props) {
  const [step, setStep] = useState<'business' | 'team' | 'connections'>(
    'business',
  )
  const { settings } = props
  return (
    <section className={styles.operations} aria-label="Email setup">
      <h3>Setup & settings</h3>
      <p>
        Save the basics now and return here for connections. Sending stays off
        until the remaining checks pass.
      </p>
      <nav className={styles.views} aria-label="Setup steps">
        <button
          aria-pressed={step === 'business'}
          onClick={() => setStep('business')}
        >
          1. Business · {settings.config.business ? 'Saved' : 'Needed'}
        </button>
        <button aria-pressed={step === 'team'} onClick={() => setStep('team')}>
          2. Team · {settings.config.team ? 'Saved' : 'Needed'}
        </button>
        <button
          aria-pressed={step === 'connections'}
          onClick={() => setStep('connections')}
        >
          3. Connections · Pending
        </button>
      </nav>
      {step === 'business' && (
        <BusinessForm key={settings.revision} {...props} />
      )}
      {step === 'team' && <TeamForm key={settings.revision} {...props} />}
      {step === 'connections' && <EmailConnections />}
      <details>
        <summary>Advanced: team access</summary>
        <p>
          Changes affect Email permissions. The last owner cannot be removed.
          Reduced access holds affected work for review; it never hands a
          conversation to AI.
        </p>
        {settings.members.map((member) => (
          <MemberForm
            key={`${member.id}:${member.revision}:${member.affectedWorkHash}`}
            member={member}
            busy={props.busy}
            act={props.act}
          />
        ))}
      </details>
    </section>
  )
}
