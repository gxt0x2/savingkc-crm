import { afterRequest } from '@/lib/after-request'
import { supabaseAdmin } from '@/lib/supabase/admin'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts'
const EXPO_BATCH_SIZE = 100
export const EXPO_RECEIPT_DELAY_MS = 8_000

export type MobilePushData = Record<string, string>

export type MobilePushPayload = {
  title: string
  body: string
  data?: MobilePushData
}

type MobilePushDevice = {
  token: string
  user_id: string
}

type ExpoPushTicket = {
  id?: string
  status?: string
  message?: string
  details?: { error?: string }
}

type ExpoPushReceipt = {
  status?: string
  message?: string
  details?: { error?: string }
}

type PendingExpoReceipt = {
  id: string
  token: string
}

function expoAccessToken(): string | undefined {
  const token = process.env.EXPO_ACCESS_TOKEN?.trim()
  return token || undefined
}

/** True only when the Expo send path is explicitly enabled. Fail-closed by default. */
export function isMobilePushConfigured(): boolean {
  const enabled = (process.env.MOBILE_PUSH_ENABLED || '').trim().toLowerCase() === 'true'
  return enabled || Boolean(expoAccessToken())
}

export function maskExpoPushToken(token: string): string {
  const match = /^(ExponentPushToken|ExpoPushToken)\[(.{0,4}).*([A-Za-z0-9_-]{4})\]$/.exec(token)
  if (match) return `${match[1]}[${match[2]}…${match[3]}]`
  if (token.length <= 8) return '••••'
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}

function uniqueUserIds(userIds: readonly string[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const userId of userIds) {
    const id = userId.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function chunks<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

function expoHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  const accessToken = expoAccessToken()
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  return headers
}

function ticketError(ticket: ExpoPushTicket | ExpoPushReceipt | undefined): string | undefined {
  if (!ticket || ticket.status !== 'error') return undefined
  return ticket.details?.error
}

function logExpoTicket(ticket: ExpoPushTicket | undefined, token: string): void {
  console.log('[mobile-push] ticket', {
    id: ticket?.id ?? null,
    status: ticket?.status ?? null,
    error: ticket?.details?.error ?? null,
    message: ticket?.message ?? null,
    token: maskExpoPushToken(token),
  })
}

async function removeUnregisteredTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return
  const { error } = await supabaseAdmin()
    .from('mobile_push_devices')
    .delete()
    .in('token', tokens)
  if (error) console.error('[mobile-push] failed to remove DeviceNotRegistered tokens:', error.message)
}

async function fetchExpoReceipts(ids: string[]): Promise<Record<string, ExpoPushReceipt>> {
  const response = await fetch(EXPO_RECEIPTS_URL, {
    method: 'POST',
    headers: expoHeaders(),
    body: JSON.stringify({ ids }),
  })
  if (!response.ok) {
    console.error('[mobile-push] Expo receipts HTTP', response.status)
    return {}
  }
  const payload = await response.json().catch(() => null) as { data?: Record<string, ExpoPushReceipt> } | null
  return payload?.data && typeof payload.data === 'object' ? payload.data : {}
}

export async function checkExpoReceipts(pending: PendingExpoReceipt[]): Promise<void> {
  const ids = [...new Set(pending.map((item) => item.id).filter(Boolean))]
  if (ids.length === 0) return
  try {
    const receipts = await fetchExpoReceipts(ids)
    const unregistered: string[] = []
    for (const item of pending) {
      const receipt = receipts[item.id]
      console.log('[mobile-push] receipt', {
        id: item.id,
        status: receipt?.status ?? null,
        error: receipt?.details?.error ?? null,
        message: receipt?.message ?? null,
        token: maskExpoPushToken(item.token),
      })
      if (ticketError(receipt) === 'DeviceNotRegistered') unregistered.push(item.token)
    }
    await removeUnregisteredTokens([...new Set(unregistered)])
  } catch (error) {
    console.error('[mobile-push] receipt check failed:', error)
  }
}

function scheduleExpoReceiptCheck(pending: PendingExpoReceipt[]): void {
  if (pending.length === 0) return
  afterRequest(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, EXPO_RECEIPT_DELAY_MS)
    })
    await checkExpoReceipts(pending)
  })
}

async function postExpoBatch(
  messages: Array<{ to: string; title: string; body: string; data: MobilePushData }>,
): Promise<{ sent: number; unregistered: string[] }> {
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: expoHeaders(),
    body: JSON.stringify(messages),
  })
  if (!response.ok) {
    console.error('[mobile-push] Expo push HTTP', response.status)
    return { sent: 0, unregistered: [] }
  }

  const payload = await response.json().catch(() => null) as { data?: ExpoPushTicket | ExpoPushTicket[] } | null
  const tickets = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : []
  const unregistered: string[] = []
  const pendingReceipts: PendingExpoReceipt[] = []
  let sent = 0
  messages.forEach((message, index) => {
    const ticket = tickets[index]
    logExpoTicket(ticket, message.to)
    if (ticket?.status === 'ok') {
      sent += 1
      if (ticket.id) pendingReceipts.push({ id: ticket.id, token: message.to })
      return
    }
    if (ticketError(ticket) === 'DeviceNotRegistered') unregistered.push(message.to)
  })
  scheduleExpoReceiptCheck(pendingReceipts)
  return { sent, unregistered }
}

async function userIdsForAgentEmails(emails: readonly string[]): Promise<string[]> {
  if (emails.length === 0) return []
  const { data, error } = await supabaseAdmin()
    .from('agent_profiles')
    .select('user_id, email')
    .in('email', emails)
  if (error) {
    console.error('[mobile-push] failed to resolve agent profiles:', error.message)
    return []
  }
  const byEmail = new Map<string, string>()
  for (const profile of (data || []) as Array<{ user_id: string | null; email: string | null }>) {
    const userId = typeof profile.user_id === 'string' ? profile.user_id.trim() : ''
    const email = typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : ''
    if (!userId || !email || byEmail.has(email)) continue
    byEmail.set(email, userId)
  }
  const seen = new Set<string>()
  const userIds: string[] = []
  for (const email of emails) {
    const userId = byEmail.get(email)
    if (!userId || seen.has(userId)) continue
    seen.add(userId)
    userIds.push(userId)
  }
  return userIds
}

/**
 * Resolve Ernest/Casey-style agent names to user ids and send Expo push.
 * Fail-closed: callers never see thrown errors.
 */
export async function sendMobilePushToAgentNames(
  agentNames: readonly string[],
  payload: MobilePushPayload,
): Promise<number> {
  try {
    const emails = [...new Set(
      agentNames
        .map((name) => name.trim().split(/\s+/)[0]?.toLowerCase())
        .filter((name): name is string => Boolean(name))
        .map((name) => `${name}@savingkc.com`),
    )]
    if (emails.length === 0) return 0
    return sendMobilePushToUsers(await userIdsForAgentEmails(emails), payload)
  } catch (error) {
    console.error('[mobile-push] agent name send failed:', error)
    return 0
  }
}

/**
 * Send an Expo push to every registered device for the given users.
 * Fail-closed: callers never see thrown errors.
 */
export async function sendMobilePushToUsers(
  userIds: readonly string[],
  payload: MobilePushPayload,
): Promise<number> {
  try {
    if (!isMobilePushConfigured()) return 0
    const ids = uniqueUserIds(userIds)
    if (ids.length === 0) return 0

    const { data, error } = await supabaseAdmin()
      .from('mobile_push_devices')
      .select('token, user_id')
      .in('user_id', ids)

    if (error) {
      console.error('[mobile-push] failed to read devices:', error.message)
      return 0
    }

    const devices = ((data || []) as MobilePushDevice[]).filter(
      (device) => typeof device.token === 'string' && device.token.length > 0 && typeof device.user_id === 'string' && device.user_id.length > 0,
    )
    const messages = devices.map((device) => ({
      to: device.token,
      title: payload.title,
      body: payload.body,
      data: {
        ...(payload.data || {}),
        recipientUserId: device.user_id,
      },
    }))

    let sent = 0
    const unregistered: string[] = []
    for (const batch of chunks(messages, EXPO_BATCH_SIZE)) {
      const result = await postExpoBatch(batch)
      sent += result.sent
      unregistered.push(...result.unregistered)
    }
    await removeUnregisteredTokens([...new Set(unregistered)])
    console.log(`[mobile-push] sent ${sent}/${messages.length}`)
    return sent
  } catch (error) {
    console.error('[mobile-push] send failed:', error)
    return 0
  }
}
