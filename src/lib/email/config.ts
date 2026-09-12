import { z } from 'zod'

export const emailWorkspaceConfigSchema = z
  .object({
    business: z
      .object({
        name: z.string().trim().min(1).max(200),
        address: z.string().trim().min(1).max(1_000),
        primaryDomain: z.string().trim().min(1).max(255),
        timezone: z.string().trim().min(1).max(100),
        programs: z
          .array(
            z.enum(['seller_outreach', 'seller_nurture', 'buyer_marketing']),
          )
          .min(1)
          .max(3),
        contact: z.string().trim().min(1).max(500),
        privacyUrl: z.string().url().max(2_000),
      })
      .optional(),
    team: z
      .object({
        reviewerId: z.string().uuid(),
        acquisitionOwnerId: z.string().uuid(),
        backupId: z.string().uuid(),
        hours: z
          .object({
            timezone: z.string().trim().min(1),
            weekdays: z
              .array(
                z.enum([
                  'monday',
                  'tuesday',
                  'wednesday',
                  'thursday',
                  'friday',
                  'saturday',
                  'sunday',
                ]),
              )
              .min(1)
              .max(7),
            startLocal: z.string(),
            endLocal: z.string(),
          })
          .strict(),
        sla: z
          .object({
            urgentMinutes: z.number().int().positive(),
            ordinaryMinutes: z.number().int().positive(),
          })
          .strict(),
        calendarMode: z.enum(['manual', 'connected']),
      })
      .strict()
      .optional(),
    automation: z
      .object({
        mode: z.enum(['draft_only', 'bounded_auto']),
        playbookVersionId: z.string().uuid(),
        maxReplies: z.number().int().min(0).max(3),
        language: z.string().trim().min(2).max(20),
        allowedActions: z.array(z.string().trim().min(1)).max(6),
      })
      .strict()
      .optional(),
    readiness: z
      .object({
        runId: z.string().uuid(),
        configHash: z.string().trim().min(8),
        state: z.enum(['current', 'stale', 'failed']),
        checkedAt: z.string().datetime({ offset: true }),
      })
      .strict()
      .optional(),
  })
  .strict()

export type EmailWorkspaceConfig = z.infer<typeof emailWorkspaceConfigSchema>
