import "server-only";

import { holdCallbackTask, projectThreadHistory } from "./crm-history";
import {
  WorkflowError,
  type SuppressionContext,
  type Tx,
} from "./workflow/core";

export type CrmProjectionChanges = {
  history?: boolean;
  holdReason?: "marketing_stopped" | "team_role_changed";
};

export type CrmProjectionRepairResult = {
  state: "complete" | "pending";
  historyRequired: boolean;
  callbackHoldRequired: boolean;
};

type RepairRow = {
  id: string;
  state: "pending" | "resolved";
  history_required: boolean;
  callback_hold_required: boolean;
  callback_hold_reason: CrmProjectionChanges["holdReason"] | null;
};

const safeErrorCode = /^[A-Z][A-Z0-9_]{0,99}$/;

function projectionErrorCode(error: unknown) {
  if (error instanceof WorkflowError && safeErrorCode.test(error.code))
    return error.code;
  return "CRM_PROJECTION_FAILED";
}

async function isolatedProjection(
  context: SuppressionContext,
  project: (savepointContext: SuppressionContext) => Promise<unknown>,
) {
  try {
    await context.tx.savepoint(async (savepoint) => {
      await project({
        ...context,
        tx: savepoint as unknown as Tx,
      });
    });
    return null;
  } catch (error) {
    return projectionErrorCode(error);
  }
}

/**
 * Attempts optional local CRM projections without making the surrounding Email
 * command depend on them. Existing pending obligations are always merged with
 * newly requested work, and each projection gets its own database savepoint so
 * one failure cannot roll back either the core Email change or the other CRM
 * projection. No provider or model calls occur here.
 */
export async function projectCrmChanges(
  context: SuppressionContext,
  threadId: string,
  changes: CrmProjectionChanges = {},
): Promise<CrmProjectionRepairResult> {
  const { tx, member, now } = context;
  const [repair] = await tx<RepairRow[]>`select id,state,history_required,
    callback_hold_required,callback_hold_reason
    from em_crm_projection_repairs
    where workspace_id=${member.workspace_id} and thread_id=${threadId}
    for update`;
  const wasPending = repair?.state === "pending";

  let historyRequired =
    Boolean(changes.history) || Boolean(wasPending && repair.history_required);
  let callbackHoldRequired =
    Boolean(changes.holdReason) ||
    Boolean(wasPending && repair.callback_hold_required);
  const priorHoldReason = wasPending ? repair.callback_hold_reason : null;
  const callbackHoldReason =
    changes.holdReason === "marketing_stopped" ||
    priorHoldReason === "marketing_stopped"
      ? "marketing_stopped"
      : (changes.holdReason ?? priorHoldReason);

  if (!historyRequired && !callbackHoldRequired)
    return {
      state: "complete",
      historyRequired: false,
      callbackHoldRequired: false,
    };

  let lastErrorCode: string | null = null;
  if (historyRequired) {
    const errorCode = await isolatedProjection(context, (savepointContext) =>
      projectThreadHistory(savepointContext, threadId),
    );
    if (errorCode) lastErrorCode = errorCode;
    else historyRequired = false;
  }

  if (callbackHoldRequired) {
    const errorCode = callbackHoldReason
      ? await isolatedProjection(context, (savepointContext) =>
          holdCallbackTask(savepointContext, threadId, callbackHoldReason),
        )
      : "CRM_PROJECTION_FAILED";
    if (errorCode) lastErrorCode = errorCode;
    else callbackHoldRequired = false;
  }

  const notificationKey = `crm-projection-repair:${threadId}`;
  if (!historyRequired && !callbackHoldRequired) {
    if (wasPending) {
      await tx`update em_crm_projection_repairs set
        state='resolved',history_required=false,callback_hold_required=false,
        callback_hold_reason=null,attempt_count=attempt_count+1,
        last_attempt_at=${now},resolved_at=${now},updated_at=${now}
        where workspace_id=${member.workspace_id} and thread_id=${threadId}`;
      await tx`update em_notifications
        set kind='CRM repair resolved'
        where workspace_id=${member.workspace_id}
          and logical_key=${notificationKey}`;
    }
    return {
      state: "complete",
      historyRequired: false,
      callbackHoldRequired: false,
    };
  }

  const errorCode = lastErrorCode ?? "CRM_PROJECTION_FAILED";
  const storedCallbackHoldReason = callbackHoldRequired
    ? (callbackHoldReason as NonNullable<CrmProjectionChanges["holdReason"]>)
    : null;
  await tx`insert into em_crm_projection_repairs(
      workspace_id,thread_id,state,history_required,callback_hold_required,
      callback_hold_reason,last_error_code,attempt_count,first_failed_at,
      last_attempt_at,last_failed_at,created_at,updated_at
    ) values(
      ${member.workspace_id},${threadId},'pending',${historyRequired},
      ${callbackHoldRequired},
      ${storedCallbackHoldReason},${errorCode},1,${now},
      ${now},${now},${now},${now}
    ) on conflict(workspace_id,thread_id) do update set
      state='pending',history_required=excluded.history_required,
      callback_hold_required=excluded.callback_hold_required,
      callback_hold_reason=excluded.callback_hold_reason,
      last_error_code=excluded.last_error_code,
      attempt_count=em_crm_projection_repairs.attempt_count+1,
      last_attempt_at=excluded.last_attempt_at,
      last_failed_at=excluded.last_failed_at,resolved_at=null,
      updated_at=excluded.updated_at`;

  await tx`insert into em_notifications(
      workspace_id,thread_id,recipient_id,kind,logical_key,created_at
    ) select distinct
      ${member.workspace_id}::uuid,${threadId}::uuid,membership.auth_user_id,
      'CRM repair needed',${notificationKey},${now}
    from em_memberships membership
    where membership.workspace_id=${member.workspace_id}
      and membership.active
      and (
        membership.roles @> array['owner']::text[]
        or membership.auth_user_id in (
          select handoff.owner_id from em_handoffs handoff
          where handoff.workspace_id=${member.workspace_id}
            and handoff.thread_id=${threadId}
        )
      )
    on conflict(workspace_id,recipient_id,logical_key) do update set
      kind=excluded.kind,thread_id=excluded.thread_id,
      acknowledged_at=null,created_at=excluded.created_at`;

  return {
    state: "pending",
    historyRequired,
    callbackHoldRequired,
  };
}
