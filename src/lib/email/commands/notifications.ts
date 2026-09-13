import 'server-only'
import type { EmailCommand } from '../contracts'
import { check, type Context, type Result } from '../workflow/core'

export function pushConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() &&
      process.env.VAPID_PRIVATE_KEY?.trim(),
  )
}

export async function applyNotificationTest(
  context: Context,
  command: Extract<EmailCommand, { command: 'NTF-TEST' }>,
): Promise<Result> {
  const { tx, member, now } = context,
    ws = member.workspace_id
  check(command.payload.channel === 'push', 'UNSUPPORTED_ALERT_CHANNEL', 400)
  const configured = pushConfigured()
  const eventKey = `push-test:${command.idempotencyKey}`
  const [delivery] =
    await tx`insert into em_notification_deliveries(workspace_id,event_key,recipient_id,channel,attempt,state,subscription_ref,failure_code,created_at)
    values(${ws},${eventKey},${member.auth_user_id},'push',1,${configured ? 'failed' : 'blocked'},${command.payload.subscriptionRef},${configured ? 'PUSH_DEVICE_UNVERIFIED' : 'PUSH_NOT_CONFIGURED'},${now})
    on conflict (workspace_id,event_key,recipient_id,channel,attempt) do update set failure_code=em_notification_deliveries.failure_code
    returning id,state,failure_code`
  return {
    entityId: delivery.id,
    state:
      delivery.failure_code === 'PUSH_DEVICE_UNVERIFIED'
        ? 'push_device_unverified'
        : 'push_not_configured',
  }
}
