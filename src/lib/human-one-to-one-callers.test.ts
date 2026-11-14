import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { POST as bulkPost } from '@/app/api/sms/bulk/route'

const root = process.cwd()

const serviceCallers = [
  'src/app/api/workers/sms-sender/route.ts',
  'src/lib/server/appointment-sequence.ts',
  'src/lib/server/prospecting-campaign-worker.ts',
  'src/lib/email/notifications/sms-worker.ts',
  'src/lib/email/notifications/sms-provider.ts',
  'src/app/api/cron/appointment-outcomes/route.ts',
  'src/app/api/cron/process-mojo-queue/route.ts',
  'src/app/api/workers/ppc-conversion-export-alert/route.ts',
]

describe('human 1:1 SMS is not available to service callers', () => {
  it('keeps bulk SMS from sending, including with the human template and many recipients', async () => {
    const source = readFileSync(join(root, 'src/app/api/sms/bulk/route.ts'), 'utf8')
    expect(source).not.toContain('sendLeadSms')
    expect(source).not.toContain('safeSendSMS')
    expect(source).not.toContain('HUMAN_1TO1_SMS_TEMPLATE_ID')

    const response = await bulkPost()
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ ok: false })
  })

  it('keeps crons, sequences, workflows, and workers off the human template', () => {
    for (const file of serviceCallers) {
      const source = readFileSync(join(root, file), 'utf8')
      expect(source, file).not.toContain('sms.conversation.1to1.v1')
      expect(source, file).not.toContain('HUMAN_1TO1_SMS_TEMPLATE_ID')
      expect(source, file).not.toContain('humanSession')
    }
  })
})
