import 'server-only'
import { createHmac, randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import { z } from 'zod'
import { emailAiAvailable } from '../ai/provider'
import { currentCredentialVersion, encryptEmailSecret, maskSecret } from '../secrets'
import { connectionSecretAad } from './aad'
import {
  connectionKeyVersion,
  connectionMasterKey,
  ownerWorkspace,
} from './access'
import { replacementImpact } from './lifecycle'
export { connectionMasterKey, ownerWorkspace } from './access'
import { check, json, workflowHash, WorkflowError, type Tx } from '../workflow/core'
import { checkResendConnection, type ConnectionChecker } from './resend-check'

export const connectionInputSchema = z
  .object({
    provider: z.literal('resend'),
    kind: z.literal('email'),
    secret: z
      .string()
      .trim()
      .regex(/^re_[A-Za-z0-9_-]{12,200}$/),
    expectedRevision: z.number().int().nonnegative(),
    accountLabel: z.string().trim().min(1).max(120),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
export async function readConnections(
  sql: Sql,
  subject: string,
  key = connectionMasterKey(),
) {
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx
    const ws = await ownerWorkspace(tx, subject)
    const rows =
      await tx`select id,provider,account_label,masked_secret,state,capabilities,failure_code,created_at,checked_at,key_version,superseded_by,replacement_reviewed_at
      from em_service_connections where workspace_id=${ws.id} order by created_at desc,id limit 50`
    const webhooks =
      await tx`select id,connection_id,active,revision,key_version,masked_secret,rotated_at,created_at
      from em_webhook_endpoints where workspace_id=${ws.id} order by created_at,id`
    const domains =
      await tx`select connection_id,count(*)::int as n from em_domains where workspace_id=${ws.id} group by connection_id`
    const events =
      await tx`select connection_id,count(*)::int as n from em_provider_events where workspace_id=${ws.id} group by connection_id`
    const [ai] =
      await tx`select state,failure_code from em_ai_generations where workspace_id=${ws.id} order by created_at desc,id desc limit 1`
    const impact = await disconnectImpact(tx, ws.id)
    const replacement = await replacementImpact(tx, ws.id)
    return {
      disconnectImpact: {
        hash: impact.hash,
        activeCampaigns: impact.campaigns.length,
        queuedMessages: impact.intents.length,
      },
      replacementReview: {
        hash: replacement.hash,
        historicalAccounts: rows.filter((c) => c.state !== 'checking').length,
        domainsByConnection: Object.fromEntries(
          domains.map((d) => [d.connection_id, d.n]),
        ),
        eventsByConnection: Object.fromEntries(
          events.map((e) => [e.connection_id, e.n]),
        ),
      },
      webhooks,
      credentialStorage: {
        configured: Boolean(key),
        currentVersion: currentCredentialVersion(),
        storedVersions: [
          ...new Set(rows.map((c) => Number(c.key_version))),
        ].sort((a, b) => a - b),
      },
      ai: {
        configured: emailAiAvailable(),
        lastState: ai?.state ?? null,
        failureCode: ai?.failure_code ?? null,
      },
      configured: Boolean(key),
      revision: ws.revision,
      connections: rows,
    }
  })
}

export async function connectService(
  sql: Sql,
  subject: string,
  raw: unknown,
  checker: ConnectionChecker = checkResendConnection,
  key = connectionMasterKey(),
  now = new Date(),
) {
  const parsed = connectionInputSchema.safeParse(raw)
  check(parsed.success, 'INVALID_CONNECTION', 400)
  check(key, 'CREDENTIAL_STORAGE_REQUIRED', 503)
  const input = parsed.data
  // Keyed fingerprint permits replay comparison without persisting the key or a plain secret hash.
  const fingerprint = createHmac('sha256', key)
    .update(JSON.stringify(input))
    .digest('hex')
  const candidateId = randomUUID()
  const reservation = await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx
    const ws = await ownerWorkspace(tx, subject)
    const [prior] =
      await tx`select id,request_fingerprint,state from em_service_connections
      where workspace_id=${ws.id} and created_by=${subject} and request_id=${input.idempotencyKey}`
    if (prior) {
      check(prior.request_fingerprint === fingerprint, 'IDEMPOTENCY_MISMATCH')
      return {
        id: prior.id as string,
        created: false,
        workspace: ws.id as string,
      }
    }
    check(ws.revision === input.expectedRevision, 'REVISION_CONFLICT')
    const [count] =
      await tx`select count(*)::int as n from em_service_connections
      where workspace_id=${ws.id} and created_at>${new Date(now.getTime() - 3600000)}`
    check(count.n < 10, 'SERVICE_CHECK_LIMIT', 429)
    const keyVersion = connectionKeyVersion()
    const encrypted = encryptEmailSecret(
      input.secret,
      key,
      connectionSecretAad(ws.id, candidateId, keyVersion),
      keyVersion,
    )
    await tx`insert into em_service_connections(id,workspace_id,created_by,request_id,request_fingerprint,
      provider,account_label,masked_secret,encrypted_secret,state,workspace_revision,created_at,key_version)
      values(${candidateId},${ws.id},${subject},${input.idempotencyKey},${fingerprint},'resend',${input.accountLabel},
      ${maskSecret(input.secret)},${tx.json(json(encrypted))},'checking',${ws.revision},${now},${keyVersion})`
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
      values(${ws.id},${subject},'SVC-CONNECT',${candidateId},${input.idempotencyKey},${tx.json({ state: 'checking', provider: 'resend' })},${now})`
    return { id: candidateId, created: true, workspace: ws.id as string }
  })
  if (reservation.created) {
    let capabilities = {},
      failure: string | null = null
    try {
      capabilities = await checker(input.secret)
    } catch (error) {
      failure =
        error instanceof WorkflowError &&
        [
          'SERVICE_UNREACHABLE',
          'SERVICE_KEY_INVALID',
          'SERVICE_SCOPE_REQUIRED',
          'SERVICE_RATE_LIMIT',
          'SERVICE_CHECK_FAILED',
        ].includes(error.code)
          ? error.code
          : 'SERVICE_CHECK_FAILED'
    }
    await sql.begin(async (transaction) => {
      const tx = transaction as unknown as Tx
      const [ws] =
        await tx`select revision from em_workspaces where id=${reservation.workspace} for update`
      const [member] =
        await tx`select m.auth_user_id from em_memberships m join agent_profiles p
        on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id)
        where m.workspace_id=${reservation.workspace} and m.auth_user_id=${subject} and m.active and 'owner'=any(m.roles)`
      if (!member || ws.revision !== input.expectedRevision)
        failure = 'SERVICE_REVIEW_CHANGED'
      const changed =
        await tx`update em_service_connections set state=${failure ? 'failed' : 'checked'},failure_code=${failure},
        capabilities=${tx.json(json(failure ? {} : capabilities))},
        encrypted_secret=case when ${Boolean(failure)} then null else encrypted_secret end,
        checked_at=${new Date(Math.max(now.getTime(), Date.now()))}
        where id=${reservation.id} and workspace_id=${reservation.workspace} and state='checking' returning id`
      if (changed.length)
        await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail)
        values(${reservation.workspace},${subject},'SVC-CHECK',${reservation.id},${input.idempotencyKey},
        ${tx.json({ state: failure ? 'failed' : 'checked', failureCode: failure })})`
      // Checked read access never changes send_enabled, ai_auto_enabled or setup completion.
    })
  }
  // Re-authorize again before returning the masked result.
  const state = await readConnections(sql, subject, key)
  return { ...state, connectionId: reservation.id }
}

async function disconnectImpact(tx: Tx, workspaceId: string) {
  const campaigns =
    await tx`select id,revision,state from em_campaigns where workspace_id=${workspaceId} and state='active' order by id`
  const intents =
    await tx`select id,state from em_send_intents where workspace_id=${workspaceId} and state in ('queued','held') order by id`
  const domains =
    await tx`select id,connection_id,revision,paused from em_domains where workspace_id=${workspaceId} order by id`
  const senders =
    await tx`select id,domain_id,revision,state from em_senders where workspace_id=${workspaceId} order by id`
  return {
    campaigns,
    intents,
    domains,
    senders,
    hash: workflowHash({ campaigns, intents, domains, senders }),
  }
}
const disconnectSchema = z
  .object({
    connectionId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    confirmedAffectedHash: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
export async function disconnectService(
  sql: Sql,
  subject: string,
  raw: unknown,
) {
  const parsed = disconnectSchema.safeParse(raw)
  check(parsed.success, 'INVALID_CONNECTION', 400)
  const input = parsed.data
  await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject)
    const [connection] =
      await tx`select id,state from em_service_connections where workspace_id=${ws.id} and id=${input.connectionId} for update`
    check(connection, 'CONNECTION_NOT_FOUND', 404)
    const hash = workflowHash(input)
    const [prior] =
      await tx`select payload_hash from em_command_receipts where workspace_id=${ws.id} and actor_id=${subject} and idempotency_key=${input.idempotencyKey}`
    if (prior) {
      check(prior.payload_hash === hash, 'IDEMPOTENCY_MISMATCH')
      return
    }
    check(ws.revision === input.expectedRevision, 'REVISION_CONFLICT')
    const impact = await disconnectImpact(tx, ws.id)
    check(
      impact.hash === input.confirmedAffectedHash,
      'CONNECTION_IMPACT_CHANGED',
    )
    check(connection.state !== 'revoked', 'CONNECTION_ALREADY_REVOKED')
    await tx`update em_service_connections set state='revoked',encrypted_secret=null,capabilities='{}'::jsonb where id=${connection.id}`
    await tx`update em_domains set paused=true,state='held',failure_code='DOMAIN_CONNECTION_REQUIRED',check_token=null,revision=revision+1 where workspace_id=${ws.id} and connection_id=${connection.id}`
    await tx`update em_senders set state='paused',revision=revision+1 where workspace_id=${ws.id} and state='active' and domain_id in (select id from em_domains where connection_id=${connection.id} and workspace_id=${ws.id})`
    await tx`update em_workspaces set send_enabled=false,ai_auto_enabled=false,setup_completed_at=null,pause_reason='Provider connection disconnected',revision=revision+1 where id=${ws.id}`
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail)
      values(${ws.id},${subject},'SVC-DISCONNECT',${connection.id},${input.idempotencyKey},${tx.json({ reason: input.reason, pausedWorkspace: true, activeCampaigns: impact.campaigns.length, queuedMessages: impact.intents.length })})`
    await tx`insert into em_command_receipts(workspace_id,actor_id,idempotency_key,command,payload_hash,result)
      values(${ws.id},${subject},${input.idempotencyKey},'SVC-DISCONNECT',${hash},${tx.json({ entityId: connection.id, state: 'revoked' })})`
  })
  return readConnections(sql, subject)
}
