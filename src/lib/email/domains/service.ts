import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import { emailCommandSchema } from '../contracts'
import { connectionMasterKey, ownerWorkspace } from '../connections/service'
import { decryptEmailSecret } from '../secrets'
import { assertIndependentSendingDomain } from '../providers/resend-domains'
import {
  check,
  json,
  workflowHash,
  WorkflowError,
  type Tx,
} from '../workflow/core'
import {
  resendDomainProvider,
  type DomainProvider,
  type ProviderDomain,
} from './provider'

export async function readDomains(sql: Sql, subject: string) {
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject)
    const [config] =
      await tx`select config from em_workspaces where id=${ws.id}`
    const domains =
      await tx`select d.*,c.state as connection_state from em_domains d join em_service_connections c on c.id=d.connection_id and c.workspace_id=d.workspace_id where d.workspace_id=${ws.id} order by d.created_at,d.id limit 100`
    const senders =
      await tx`select * from em_senders where workspace_id=${ws.id} order by created_at,id limit 100`
    const connections =
      await tx`select id,account_label from em_service_connections where workspace_id=${ws.id} and state='checked' order by created_at desc`
    // Explicit projection: check_token and creator metadata do not belong in the UI.
    return {
      revision: ws.revision,
      primaryDomain: config.config?.business?.primaryDomain ?? null,
      configured: Boolean(connectionMasterKey()),
      connections,
      domains: domains.map((d) => ({
        id: d.id,
        connection_id: d.connection_id,
        connection_state: d.connection_state,
        name: d.name_ascii,
        brand_url: d.brand_url,
        state: d.state,
        sending_state: d.sending_state,
        receiving_state: d.receiving_state,
        dns_records: d.dns_records,
        paused: d.paused,
        failure_code: d.failure_code,
        revision: d.revision,
        last_verified_at: d.last_verified_at,
        last_checked_at: d.last_checked_at,
      })),
      senders,
    }
  })
}
async function connectionSecret(
  tx: Tx,
  workspaceId: string,
  id: string,
  key: Buffer | null,
) {
  check(key, 'CREDENTIAL_STORAGE_REQUIRED', 503)
  const [row] =
    await tx`select * from em_service_connections where workspace_id=${workspaceId} and id=${id} and state='checked'`
  check(row?.encrypted_secret, 'DOMAIN_CONNECTION_REQUIRED')
  try {
    return decryptEmailSecret(
      row.encrypted_secret,
      key,
      `${workspaceId}/${id}/resend/1`,
    )
  } catch {
    throw new WorkflowError('CREDENTIAL_DECRYPT_FAILED', 503)
  }
}
function independent(domain: string, primary: string | undefined) {
  check(primary, 'BUSINESS_SETUP_REQUIRED')
  try {
    return assertIndependentSendingDomain(domain, primary)
  } catch (error) {
    throw new WorkflowError(
      error instanceof Error ? error.message : 'INVALID_EMAIL_DOMAIN',
      400,
    )
  }
}
export async function executeDomainCommand(
  sql: Sql,
  subject: string,
  raw: unknown,
  provider: DomainProvider = resendDomainProvider,
  key = connectionMasterKey(),
  now = new Date(),
) {
  const parsed = emailCommandSchema.safeParse(raw)
  check(parsed.success, 'INVALID_COMMAND', 400)
  const command = parsed.data
  check(
    ['DOM-ADD', 'DOM-VERIFY', 'DOM-PAUSE', 'SND-SAVE'].includes(
      command.command,
    ),
    'ACTION_NOT_IMPLEMENTED',
    400,
  )
  const hash = workflowHash(command)
  const reserved = await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject)
    const [prior] =
      await tx`select payload_hash,result from em_command_receipts where workspace_id=${ws.id} and actor_id=${subject} and idempotency_key=${command.idempotencyKey}`
    if (prior) {
      check(prior.payload_hash === hash, 'IDEMPOTENCY_MISMATCH')
      return { entityId: prior.result.entityId as string, remote: null }
    }
    const [workspace] =
      await tx`select config from em_workspaces where id=${ws.id}`
    const primary = workspace.config?.business?.primaryDomain as
      | string
      | undefined
    let entityId: string, state: string
    let remote: null | {
      domainId: string
      domain: string
      connectionId: string
      secret: string
      token: string
      workspaceId: string
      workspaceRevision: number
      create: boolean
      providerId: string | null
    } = null
    if (command.command === 'DOM-ADD') {
      check(command.expectedRevision === ws.revision, 'REVISION_CONFLICT')
      const domain = independent(command.payload.domain, primary)
      const url = new URL(command.payload.brandUrl)
      check(
        url.protocol === 'https:' && !url.username && !url.password,
        'HTTPS_BRAND_URL_REQUIRED',
        400,
      )
      check(
        url.hostname === domain || url.hostname.endsWith(`.${domain}`),
        'BRAND_DOMAIN_MISMATCH',
        400,
      )
      const secret = await connectionSecret(
        tx,
        ws.id,
        command.payload.connectionId,
        key,
      )
      const [existing] =
        await tx`select id,connection_id,brand_url,state from em_domains where workspace_id=${ws.id} and name_ascii=${domain}`
      if (existing) {
        check(
          existing.connection_id === command.payload.connectionId &&
            existing.brand_url === command.payload.brandUrl,
          'DOMAIN_EXISTS_REVIEW',
        )
        entityId = existing.id
        state = existing.state
      } else {
        const token = randomUUID()
        const [row] =
          await tx`insert into em_domains(workspace_id,connection_id,name_ascii,brand_url,created_by,check_token,created_at)
          values(${ws.id},${command.payload.connectionId},${domain},${command.payload.brandUrl},${subject},${token},${now}) returning id`
        entityId = row.id
        state = 'creating'
        remote = {
          domainId: row.id,
          domain,
          connectionId: command.payload.connectionId,
          secret,
          token,
          workspaceId: ws.id,
          workspaceRevision: ws.revision,
          create: true,
          providerId: null,
        }
      }
    } else if (
      command.command === 'DOM-VERIFY' ||
      command.command === 'DOM-PAUSE'
    ) {
      const [domain] =
        await tx`select * from em_domains where workspace_id=${ws.id} and id=${command.payload.domainId} for update`
      check(domain, 'DOMAIN_NOT_FOUND', 404)
      check(command.expectedRevision === domain.revision, 'REVISION_CONFLICT')
      entityId = domain.id
      if (command.command === 'DOM-PAUSE') {
        check(command.payload.paused, 'DOMAIN_READINESS_REQUIRED')
        await tx`update em_domains set paused=true,check_token=null,revision=revision+1 where id=${domain.id}`
        await tx`update em_senders set state='paused',revision=revision+1 where domain_id=${domain.id} and state='active'`
        state = 'paused'
      } else {
        independent(domain.name_ascii, primary)
        check(
          domain.state !== 'creating' ||
            now.getTime() - new Date(domain.created_at).getTime() > 60000,
          'DOMAIN_CHECK_RUNNING',
        )
        const secret = await connectionSecret(
            tx,
            ws.id,
            domain.connection_id,
            key,
          ),
          token = randomUUID()
        await tx`update em_domains set check_token=${token},revision=revision+1 where id=${domain.id}`
        remote = {
          domainId: domain.id,
          domain: domain.name_ascii,
          connectionId: domain.connection_id,
          secret,
          token,
          workspaceId: ws.id,
          workspaceRevision: ws.revision,
          create: false,
          providerId: domain.provider_domain_id,
        }
        state = 'checking'
      }
    } else if (command.command === 'SND-SAVE') {
      const p = command.payload
      const [domain] =
        await tx`select * from em_domains where workspace_id=${ws.id} and id=${p.domainId}`
      check(domain, 'DOMAIN_NOT_FOUND', 404)
      independent(domain.name_ascii, primary)
      check(p.state !== 'active', 'SENDER_TEST_REQUIRED')
      check(!/[\r\n\0]/.test(p.fromName), 'INVALID_SENDER_NAME', 400)
      check(p.hourlyLimit <= p.dailyLimit, 'INVALID_SENDER_LIMITS', 400)
      check(
        p.localPart === p.localPart.toLowerCase() &&
          !p.localPart.startsWith('.') &&
          !p.localPart.endsWith('.') &&
          !p.localPart.includes('..'),
        'INVALID_SENDER_ADDRESS',
        400,
      )
      const [existing] = p.senderId
        ? await tx`select * from em_senders where workspace_id=${ws.id} and id=${p.senderId} for update`
        : []
      if (p.senderId) check(existing, 'SENDER_NOT_FOUND', 404)
      check(
        command.expectedRevision === (existing?.revision ?? ws.revision),
        'REVISION_CONFLICT',
      )
      if (existing) {
        const [thread] =
          await tx`select id from em_threads where workspace_id=${ws.id} and sender_id=${existing.id} limit 1`
        check(
          !thread ||
            (existing.domain_id === p.domainId &&
              existing.local_part === p.localPart &&
              existing.from_name === p.fromName),
          'SENDER_IDENTITY_IN_USE',
        )
        check(
          existing.state !== 'retired' || p.state === 'retired',
          'SENDER_RETIRED',
        )
        const [duplicate] =
          await tx`select id from em_senders where domain_id=${p.domainId} and local_part=${p.localPart} and id<>${existing.id}`
        check(!duplicate, 'SENDER_ADDRESS_EXISTS')
        await tx`update em_senders set domain_id=${p.domainId},from_name=${p.fromName},local_part=${p.localPart},signature=${p.signature},state=${p.state},hourly_limit=${p.hourlyLimit},daily_limit=${p.dailyLimit},revision=revision+1 where id=${existing.id}`
        entityId = existing.id
      } else {
        const [duplicate] =
          await tx`select id from em_senders where domain_id=${p.domainId} and local_part=${p.localPart}`
        check(!duplicate, 'SENDER_ADDRESS_EXISTS')
        const [row] =
          await tx`insert into em_senders(workspace_id,domain_id,from_name,local_part,signature,state,hourly_limit,daily_limit)
          values(${ws.id},${p.domainId},${p.fromName},${p.localPart},${p.signature},${p.state},${p.hourlyLimit},${p.dailyLimit}) returning id`
        entityId = row.id
      }
      state = p.state
    } else throw new WorkflowError('ACTION_NOT_IMPLEMENTED', 400)
    await tx`insert into em_command_receipts(workspace_id,actor_id,idempotency_key,command,payload_hash,result)
      values(${ws.id},${subject},${command.idempotencyKey},${command.command},${hash},${tx.json({ entityId, state })})`
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
      values(${ws.id},${subject},${command.command},${entityId},${command.idempotencyKey},${tx.json({ state })},${now})`
    return { entityId, remote }
  })
  if (reserved.remote) {
    const r = reserved.remote
    let snapshot: ProviderDomain | null = null,
      failure: string | null = null
    try {
      if (r.create) {
        try {
          snapshot = await provider.create(r.secret, r.domain)
        } catch {
          snapshot = await provider.find(r.secret, r.domain)
          if (!snapshot) failure = 'DOMAIN_CREATE_UNCERTAIN'
        }
      } else
        snapshot = r.providerId
          ? await provider.get(r.secret, r.providerId)
          : await provider.find(r.secret, r.domain)
      if (!snapshot) failure ??= 'DOMAIN_NOT_FOUND_AT_PROVIDER'
      if (snapshot && snapshot.name.toLowerCase() !== r.domain) {
        snapshot = null
        failure = 'DOMAIN_RESPONSE_MISMATCH'
      }
    } catch {
      failure = r.create
        ? 'DOMAIN_CREATE_UNCERTAIN'
        : 'DOMAIN_PROVIDER_UNAVAILABLE'
    } finally {
      r.secret = ''
    }
    await sql.begin(async (transaction) => {
      const tx = transaction as unknown as Tx
      const [ws] =
        await tx`select revision from em_workspaces where id=${r.workspaceId} for update`
      const [member] =
        await tx`select m.auth_user_id from em_memberships m join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id)
        where m.workspace_id=${r.workspaceId} and m.auth_user_id=${subject} and m.active and 'owner'=any(m.roles)`
      const [connection] =
        await tx`select state from em_service_connections where workspace_id=${r.workspaceId} and id=${r.connectionId}`
      const changed =
        !member ||
        connection?.state !== 'checked' ||
        ws.revision !== r.workspaceRevision
      const state = changed
        ? 'held'
        : failure
          ? 'uncertain'
          : snapshot?.status === 'verified'
            ? 'provider_verified'
            : 'needs_dns'
      const saved =
        await tx`update em_domains set state=${state},failure_code=${changed ? 'DOMAIN_REVIEW_CHANGED' : failure},
        provider_domain_id=coalesce(${snapshot?.id ?? null},provider_domain_id),
        sending_state=${snapshot?.capabilities.sending ?? 'unknown'},receiving_state=${snapshot?.capabilities.receiving ?? 'unknown'},
        dns_records=${tx.json(json(snapshot?.records ?? []))},last_checked_at=${new Date(Math.max(now.getTime(), Date.now()))},last_verified_at=${!changed && !failure && snapshot?.status === 'verified' ? new Date(Math.max(now.getTime(), Date.now())) : null},
        revision=revision+1,check_token=null,paused=true where id=${r.domainId} and workspace_id=${r.workspaceId} and check_token=${r.token} returning id`
      if (saved.length)
        await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail)
        values(${r.workspaceId},${subject},'DOM-VERIFY-RESULT',${r.domainId},${command.idempotencyKey},${tx.json({ state, providerDomainId: snapshot?.id ?? null, failureCode: changed ? 'DOMAIN_REVIEW_CHANGED' : failure })})`
    })
  }
  return { ...(await readDomains(sql, subject)), entityId: reserved.entityId }
}
