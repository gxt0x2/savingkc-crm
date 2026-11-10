import 'server-only'
import type { Sql } from 'postgres'
import type { NewsletterContact, NewsletterStore } from './signup'
import { workflowDatabase } from '../workflow/connection'

type Hit = { hit?: number; status?: string }

export function emailNewsletterStore(sql: Sql): NewsletterStore {
  return {
    async isSuppressed(email) {
      const stopped = await sql<Hit[]>`
        select 1 as hit
        from em_suppressions s
        join em_addresses a on a.workspace_id = s.workspace_id and a.id = s.address_id
        where lower(a.normalized_address) = ${email}
        limit 1`
      const held = await sql<Hit[]>`
        select 1 as hit
        from em_newsletter_contacts
        where normalized_email = ${email} and status = 'suppressed'
        limit 1`
      return stopped.length > 0 || held.length > 0
    },
    async save(contact: NewsletterContact) {
      const rows = await sql<Hit[]>`
        insert into em_newsletter_contacts (
          normalized_email, role, segment, county, tags, consent_text, consent_recorded_at, consent_source, status
        ) values (
          ${contact.email},
          ${contact.role},
          ${contact.segment},
          ${contact.county},
          ${sql.json(contact.tags)},
          ${contact.consent.text},
          ${contact.consent.recordedAt},
          ${contact.consent.source},
          'subscribed'
        )
        on conflict (normalized_email, role) do update set
          segment = excluded.segment,
          county = excluded.county,
          tags = excluded.tags,
          consent_text = excluded.consent_text,
          consent_recorded_at = excluded.consent_recorded_at,
          consent_source = excluded.consent_source,
          updated_at = now()
        where em_newsletter_contacts.status <> 'suppressed'
        returning status`
      return rows.length === 0 ? 'suppressed' : 'saved'
    },
  }
}

export function openEmailNewsletterStore(): NewsletterStore {
  return emailNewsletterStore(workflowDatabase())
}
