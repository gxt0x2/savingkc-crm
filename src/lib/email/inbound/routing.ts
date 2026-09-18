import 'server-only'
import type { Tx } from '../workflow/core'

export function messageReferences(headers: Record<string, string>) {
  const values = [headers['in-reply-to'] ?? '', headers.references ?? '']
  return [...new Set(values.flatMap(value => value.match(/<[^<>\s]+@[^<>\s]+>/g) ?? []))].slice(-100)
}
export function validMessageId(value: unknown): value is string {
  return typeof value === 'string' && /^<[^<>\s]+@[^<>\s]+>$/.test(value) && value.length <= 1000
}
/** A sender/recipient pair identifies candidates, never sufficient proof of a thread. */
export async function cleanReplyCandidates(tx: Tx, workspaceId: string, connectionId: string, from: string, to: string[]) {
  return tx`select distinct t.id as thread_id from em_threads t
    join em_addresses a on a.id=t.address_id and a.workspace_id=t.workspace_id
    join em_senders s on s.id=t.sender_id and s.workspace_id=t.workspace_id
    join em_domains d on d.id=s.domain_id and d.workspace_id=s.workspace_id
    where t.workspace_id=${workspaceId} and d.connection_id=${connectionId}
    and a.normalized_address=${from.toLowerCase()} and lower(s.local_part || '@' || d.name_ascii)=any(${tx.array(to)})`
}
export async function resolveReplyThread(tx: Tx, workspaceId: string, connectionId: string, content: {from:string;to:string[];received_for?:string[];headers:Record<string,string>}) {
  const addresses = (content.received_for?.length ? content.received_for : content.to).map(a => a.toLowerCase())
  const aliases = await tx`select distinct thread_id from em_reply_aliases where workspace_id=${workspaceId} and connection_id=${connectionId} and address=any(${tx.array(addresses)})`
  if (aliases.length) return aliases.length === 1 ? aliases[0].thread_id as string : null
  const candidates = await cleanReplyCandidates(tx, workspaceId, connectionId, content.from, addresses)
  const refs = messageReferences(content.headers)
  if (!candidates.length || !refs.length) return null
  const rows = await tx`select distinct thread_id from (
    select thread_id,rfc_message_id from em_messages where workspace_id=${workspaceId} and connection_id=${connectionId} and transport='resend'
    union all select thread_id,rfc_message_id from em_send_intents where workspace_id=${workspaceId} and connection_id=${connectionId} and state='accepted'
  ) messages where thread_id=any(${tx.array(candidates.map(c => c.thread_id))}::uuid[]) and rfc_message_id=any(${tx.array(refs)})`
  return rows.length === 1 ? rows[0].thread_id as string : null
}

export async function latestReplyMessageId(tx: Tx, workspaceId: string, threadId: string) {
  const [parent] = await tx`select rfc_message_id from (
    select rfc_message_id,occurred_at from em_messages where workspace_id=${workspaceId} and thread_id=${threadId} and transport='resend' and rfc_message_id is not null
    union all select rfc_message_id,accepted_at as occurred_at from em_send_intents where workspace_id=${workspaceId} and thread_id=${threadId} and state='accepted' and rfc_message_id is not null
  ) messages order by occurred_at desc,rfc_message_id limit 1`
  return parent?.rfc_message_id as string | undefined
}
