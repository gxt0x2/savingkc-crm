import 'server-only'
import { createHmac, randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import { z } from 'zod'
import {
  credentialKey,
  currentCredentialVersion,
  decryptEmailSecret,
  encryptEmailSecret,
  maskSecret,
  type CredentialKeyring,
  type EncryptedSecret,
} from '../secrets'
import { check, json, workflowHash, type Tx } from '../workflow/core'
import {
  checkResendConnection,
  type ConnectionChecker,
} from './resend-check'
import { connectionSecretAad, webhookSecretAad } from './aad'
import { connectionMasterKey, ownerWorkspace } from './access'

const webhookSecretSchema = z
  .string()
  .trim()
  .regex(/^whsec_[A-Za-z0-9+/=_-]{16,200}$/)
const lifecycleBase = z.object({
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(),
})
function decryptWithRing(
  secret: EncryptedSecret,
  key: Buffer | CredentialKeyring,
  aad: (version: number) => string,
) {
  const material = credentialKey(secret.keyVersion, key)
  check(material, 'CREDENTIAL_KEY_VERSION_REQUIRED', 503)
  return decryptEmailSecret(secret, material, aad(secret.keyVersion))
}

async function ownerReceipt(
  tx: Tx,
  workspaceId: string,
  subject: string,
  input: { idempotencyKey: string },
  command: string,
  hash: string,
  result: unknown,
) {
  const [prior] =
    await tx`select payload_hash from em_command_receipts where workspace_id=${workspaceId} and actor_id=${subject} and idempotency_key=${input.idempotencyKey}`
  if (prior) {
    check(prior.payload_hash === hash, 'IDEMPOTENCY_MISMATCH')
    return true
  }
  await tx`insert into em_command_receipts(workspace_id,actor_id,idempotency_key,command,payload_hash,result)
    values(${workspaceId},${subject},${input.idempotencyKey},${command},${hash},${tx.json(json(result))})`
  return false
}

export async function replacementImpact(tx: Tx, workspaceId: string) {
  const connections =
    await tx`select id,state,account_label,superseded_by,key_version,created_at,checked_at
      from em_service_connections where workspace_id=${workspaceId} order by created_at,id`
  const domains =
    await tx`select id,connection_id,state,paused from em_domains where workspace_id=${workspaceId} order by id`
  const events =
    await tx`select id,connection_id,type,state from em_provider_events where workspace_id=${workspaceId} order by created_at,id limit 200`
  const webhooks =
    await tx`select id,connection_id,active,revision,key_version,masked_secret,rotated_at,created_at
      from em_webhook_endpoints where workspace_id=${workspaceId} order by created_at,id`
  return {
    connections,
    domains,
    events,
    webhooks,
    hash: workflowHash({ connections, domains, events, webhooks }),
  }
}

const rotateSchema = lifecycleBase.strict()
export async function rotateCredentialSecrets(
  sql: Sql,
  subject: string,
  raw: unknown,
  keyring: CredentialKeyring | Buffer,
  now = new Date(),
) {
  const parsed = rotateSchema.safeParse(raw)
  check(parsed.success, 'INVALID_CONNECTION', 400)
  const input = parsed.data
  const targetVersion = Buffer.isBuffer(keyring)
    ? 1
    : currentCredentialVersion(keyring)
  const targetKey = Buffer.isBuffer(keyring)
    ? keyring
    : targetVersion
      ? keyring.get(targetVersion)
      : null
  check(targetKey && targetVersion, 'CREDENTIAL_STORAGE_REQUIRED', 503)
  await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject)
    const hash = workflowHash(input)
    if (await ownerReceipt(tx, ws.id, subject, input, 'SVC-ROTATE', hash, { state: 'rotated' }))
      return
    check(ws.revision === input.expectedRevision, 'REVISION_CONFLICT')
    const connections =
      await tx`select id,encrypted_secret,key_version from em_service_connections
        where workspace_id=${ws.id} and encrypted_secret is not null for update`
    for (const row of connections) {
      const plain = decryptWithRing(
        row.encrypted_secret,
        keyring,
        (version) => connectionSecretAad(ws.id, row.id, version),
      )
      const encrypted = encryptEmailSecret(
        plain,
        targetKey,
        connectionSecretAad(ws.id, row.id, targetVersion),
        targetVersion,
      )
      await tx`update em_service_connections set encrypted_secret=${tx.json(json(encrypted))},key_version=${targetVersion}
        where workspace_id=${ws.id} and id=${row.id}`
    }
    const endpoints =
      await tx`select id,encrypted_secret,key_version from em_webhook_endpoints
        where workspace_id=${ws.id} for update`
    for (const row of endpoints) {
      const plain = decryptWithRing(
        row.encrypted_secret,
        keyring,
        (version) => webhookSecretAad(ws.id, row.id, version),
      )
      const encrypted = encryptEmailSecret(
        plain,
        targetKey,
        webhookSecretAad(ws.id, row.id, targetVersion),
        targetVersion,
      )
      await tx`update em_webhook_endpoints set encrypted_secret=${tx.json(json(encrypted))},key_version=${targetVersion}
        where workspace_id=${ws.id} and id=${row.id}`
    }
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
      values(${ws.id},${subject},'SVC-ROTATE',${ws.id},${input.idempotencyKey},${tx.json({
        keyVersion: targetVersion,
        connections: connections.length,
        endpoints: endpoints.length,
      })},${now})`
  })
}

const webhookSchema = lifecycleBase
  .extend({
    connectionId: z.string().uuid(),
    secret: webhookSecretSchema,
    endpointId: z.string().uuid().optional(),
  })
  .strict()
export async function saveWebhookEndpoint(
  sql: Sql,
  subject: string,
  raw: unknown,
  key = connectionMasterKey(),
  keyVersion = 1,
  now = new Date(),
) {
  const parsed = webhookSchema.safeParse(raw)
  check(parsed.success, 'INVALID_WEBHOOK_SECRET', 400)
  check(key, 'CREDENTIAL_STORAGE_REQUIRED', 503)
  const input = parsed.data
  const fingerprint = createHmac('sha256', key)
    .update(JSON.stringify({ secret: input.secret, connectionId: input.connectionId }))
    .digest('hex')
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject)
    const hash = workflowHash({
      connectionId: input.connectionId,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      endpointId: input.endpointId ?? null,
    })
    const [prior] =
      await tx`select id,request_fingerprint from em_webhook_endpoints
        where workspace_id=${ws.id} and created_by=${subject} and request_id=${input.idempotencyKey}`
    if (prior) {
      check(prior.request_fingerprint === fingerprint, 'IDEMPOTENCY_MISMATCH')
      return { endpointId: prior.id as string, created: false }
    }
    check(ws.revision === input.expectedRevision, 'REVISION_CONFLICT')
    const [connection] =
      await tx`select id,state from em_service_connections where workspace_id=${ws.id} and id=${input.connectionId} for update`
    check(connection, 'CONNECTION_NOT_FOUND', 404)
    check(connection.state === 'checked', 'CONNECTION_NOT_READY')
    if (input.endpointId) {
      const [existing] =
        await tx`select id,revision from em_webhook_endpoints where workspace_id=${ws.id} and id=${input.endpointId} and connection_id=${connection.id} for update`
      check(existing, 'WEBHOOK_NOT_FOUND', 404)
      const encrypted = encryptEmailSecret(
        input.secret,
        key,
        webhookSecretAad(ws.id, existing.id, keyVersion),
        keyVersion,
      )
      await tx`update em_webhook_endpoints set encrypted_secret=${tx.json(json(encrypted))},
        key_version=${keyVersion},masked_secret=${maskSecret(input.secret)},active=false,
        revision=revision+1,rotated_at=${now},request_id=${input.idempotencyKey},
        request_fingerprint=${fingerprint},created_by=coalesce(created_by,${subject})
        where id=${existing.id}`
      await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
        values(${ws.id},${subject},'SVC-WEBHOOK-ROTATE',${existing.id},${input.idempotencyKey},${tx.json({
          active: false,
          keyVersion,
        })},${now})`
      await ownerReceipt(tx, ws.id, subject, input, 'SVC-WEBHOOK-ROTATE', hash, {
        entityId: existing.id,
        state: 'rotated',
      })
      return { endpointId: existing.id as string, created: false }
    }
    const endpointId = randomUUID()
    const encrypted = encryptEmailSecret(
      input.secret,
      key,
      webhookSecretAad(ws.id, endpointId, keyVersion),
      keyVersion,
    )
    await tx`insert into em_webhook_endpoints(id,workspace_id,connection_id,encrypted_secret,active,revision,
      key_version,created_by,request_id,request_fingerprint,masked_secret,created_at)
      values(${endpointId},${ws.id},${connection.id},${tx.json(json(encrypted))},false,0,
      ${keyVersion},${subject},${input.idempotencyKey},${fingerprint},${maskSecret(input.secret)},${now})`
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
      values(${ws.id},${subject},'SVC-WEBHOOK-PROVISION',${endpointId},${input.idempotencyKey},${tx.json({
        active: false,
        connectionId: connection.id,
      })},${now})`
    await ownerReceipt(tx, ws.id, subject, input, 'SVC-WEBHOOK-PROVISION', hash, {
      entityId: endpointId,
      state: 'inactive',
    })
    return { endpointId, created: true }
  })
}

const replaceSchema = lifecycleBase
  .extend({
    connectionId: z.string().uuid(),
    replacesConnectionId: z.string().uuid(),
    confirmedAffectedHash: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
export async function reviewConnectionReplacement(
  sql: Sql,
  subject: string,
  raw: unknown,
  now = new Date(),
) {
  const parsed = replaceSchema.safeParse(raw)
  check(parsed.success, 'INVALID_CONNECTION', 400)
  const input = parsed.data
  check(input.connectionId !== input.replacesConnectionId, 'INVALID_CONNECTION', 400)
  await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject)
    const hash = workflowHash(input)
    if (
      await ownerReceipt(tx, ws.id, subject, input, 'SVC-REPLACE-REVIEW', hash, {
        state: 'reviewed',
      })
    )
      return
    check(ws.revision === input.expectedRevision, 'REVISION_CONFLICT')
    const impact = await replacementImpact(tx, ws.id)
    check(impact.hash === input.confirmedAffectedHash, 'CONNECTION_IMPACT_CHANGED')
    const [next] =
      await tx`select id,state from em_service_connections where workspace_id=${ws.id} and id=${input.connectionId} for update`
    const [prior] =
      await tx`select id,state,superseded_by from em_service_connections where workspace_id=${ws.id} and id=${input.replacesConnectionId} for update`
    check(next && prior, 'CONNECTION_NOT_FOUND', 404)
    check(next.state === 'checked', 'CONNECTION_NOT_READY')
    check(!prior.superseded_by, 'CONNECTION_ALREADY_REVIEWED')
    await tx`update em_service_connections set superseded_by=${next.id},
      replacement_reviewed_at=${now},replacement_review_reason=${input.reason}
      where workspace_id=${ws.id} and id=${prior.id}`
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
      values(${ws.id},${subject},'SVC-REPLACE-REVIEW',${prior.id},${input.idempotencyKey},${tx.json({
        replacementId: next.id,
        reason: input.reason,
        domains: impact.domains.filter((d) => d.connection_id === prior.id).length,
        events: impact.events.filter((e) => e.connection_id === prior.id).length,
      })},${now})`
  })
}

const recheckSchema = lifecycleBase
  .extend({ connectionId: z.string().uuid() })
  .strict()
export async function recheckConnection(
  sql: Sql,
  subject: string,
  raw: unknown,
  checker: ConnectionChecker = checkResendConnection,
  key = connectionMasterKey(),
  now = new Date(),
) {
  const parsed = recheckSchema.safeParse(raw)
  check(parsed.success, 'INVALID_CONNECTION', 400)
  check(key, 'CREDENTIAL_STORAGE_REQUIRED', 503)
  const input = parsed.data
  const reserved = await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject)
    check(ws.revision === input.expectedRevision, 'REVISION_CONFLICT')
    const [connection] =
      await tx`select * from em_service_connections where workspace_id=${ws.id} and id=${input.connectionId} for update`
    check(connection, 'CONNECTION_NOT_FOUND', 404)
    check(connection.encrypted_secret, 'CONNECTION_SECRET_MISSING', 409)
    const secret = decryptWithRing(
      connection.encrypted_secret,
      key,
      (version) => connectionSecretAad(ws.id, connection.id, version),
    )
    return { workspaceId: ws.id as string, secret, connectionId: connection.id as string }
  })
  let failure: string | null = null,
    capabilities = {}
  try {
    capabilities = await checker(reserved.secret)
  } catch (error) {
    failure =
      error instanceof Error && 'code' in error
        ? String((error as { code: string }).code)
        : 'SERVICE_CHECK_FAILED'
  }
  reserved.secret = ''
  await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx
    await ownerWorkspace(tx, subject)
    await tx`update em_service_connections set failure_code=${failure},
      capabilities=${tx.json(json(failure ? {} : capabilities))},
      checked_at=${now}
      where workspace_id=${reserved.workspaceId} and id=${reserved.connectionId} and state='checked'`
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
      values(${reserved.workspaceId},${subject},'SVC-CHECK',${reserved.connectionId},${input.idempotencyKey},${tx.json({
        state: failure ? 'failed_recheck' : 'checked',
        failureCode: failure,
      })},${now})`
  })
}
