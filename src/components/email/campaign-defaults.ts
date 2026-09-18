import type { PilotConfig, PilotState } from "@/lib/email/workflow/types";

export function pilotDefaults(
  audienceId: string,
  data?: PilotState | null,
): PilotConfig {
  return {
    audienceId,
    senderIds:
      data?.mode === "hosted"
        ? (data.senders ?? []).slice(0, 1).map((s) => s.id)
        : ["00000000-0000-4000-8000-000000000004"],
    playbookVersionId: "00000000-0000-4000-8000-000000000005",
    mode: "draft_only",
    copyMode: "template",
    draftGenerationBudget: 0,
    steps: [
      {
        id: "00000000-0000-4000-8000-000000000006",
        delayMinCalendarDays: 0,
        delayMaxCalendarDays: 0,
        targetCalendarDay: 0,
        subject: "A question about your property",
        bodyTemplate:
          "Hi there,\n\nWould selling your property be something you would consider, or is keeping it the better fit right now?" +
          (data?.mode === "hosted"
            ? ""
            : "\n\nSavingKC\nLocal practice message — no email will be sent."),
      },
      {
        id: "00000000-0000-4000-8000-000000000007",
        delayMinCalendarDays: 7,
        delayMaxCalendarDays: 10,
        targetCalendarDay: 8,
        subject: "Re: A question about your property",
        bodyTemplate:
          "Hi there,\n\nWould you prefer I leave it here?" +
          (data?.mode === "hosted"
            ? ""
            : "\n\nSavingKC\nLocal practice message — no email will be sent."),
      },
    ],
    timezone: "America/Chicago",
    weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    startLocal: "09:00",
    endLocal: "17:00",
    dailyLimit: 10,
    hourlyLimit: 2,
    maxRecipients: 10,
    dailyCostCap: 0,
    totalCostCap: 0,
    recontactDays: 90,
    expiresAt: "2026-12-31T23:59:59.000Z",
    replyActions: [],
    requiredPermissionBasis:
      data?.mode === "hosted"
        ? "Reviewed recipient list and address-verification evidence"
        : "Fabricated local practice recipients only",
  };
}

/** Family wording is rendered only when the verified relationship is heir. */
export function inheritedPropertyCopy(config: PilotConfig): PilotConfig {
  return { ...config, steps: config.steps.map((step, index) => ({ ...step,
    subject: index === 0 ? '{{property_address}}' : 'Re: {{property_address}}',
    bodyTemplate: index === 0
      ? 'Hi {{first_name}},\n\nI’m Ari with Saving KC Homebuyers. I’m reaching out about {{property_address}}.\n\n{{property_question}}'
      : 'Hi {{first_name}},\n\nFollowing up once about {{property_address}}. Would you like to talk about selling, or would you prefer I leave it here?',
  })) }
}
