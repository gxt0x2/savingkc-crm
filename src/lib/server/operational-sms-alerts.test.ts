import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ safeSendSMS: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/safe-communications', () => ({ safeSendSMS: mocks.safeSendSMS }))

import { sendAndonRaisedSmsAlert, sendCallReviewSubmittedSmsAlert } from './operational-sms-alerts'

describe('operational SMS alerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ERNEST_PHONE', '+18160000001')
    mocks.safeSendSMS.mockImplementation(async ({ body, from, to }) => ({
      success: true,
      sid: 'SM-alert',
      body,
      from,
      to,
    }))
  })

  it('texts Ernest when an Andon is raised', async () => {
    const alert = await sendAndonRaisedSmsAlert({
      issueId: 'andon-1',
      issueKind: 'system',
      department: 'Acquisitions',
      category: 'AI Text Bot Sequence',
      priority: 'medium',
      raisedBy: 'Casey',
    })

    expect(alert.attempted).toBe(true)
    expect(mocks.safeSendSMS).toHaveBeenCalledWith({
      to: '+18160000001',
      from: '+18163077835',
      body: 'System issue: Acquisitions / AI Text Bot Sequence (medium), raised by Casey. Open: https://crm.savingkc.com/reports/andon',
    })
  })

  it('texts Ernest when a call is first submitted to his review queue', async () => {
    await sendCallReviewSubmittedSmsAlert({
      activityId: 'call-1',
      leadId: 'lead-1',
      frameworkLabel: 'Jr. Acquisitions Scorecard',
      submittedBy: 'casey@savingkc.com',
      assignedReviewer: 'ernest@savingkc.com',
    })

    expect(mocks.safeSendSMS).toHaveBeenCalledWith(expect.objectContaining({
      to: '+18160000001',
      body: 'Call review submitted by casey@savingkc.com — Jr. Acquisitions Scorecard. Open: https://crm.savingkc.com/leads/lead-1',
    }))
  })

  it('does not guess a phone number for another reviewer', async () => {
    const alert = await sendCallReviewSubmittedSmsAlert({
      activityId: 'call-1',
      leadId: 'lead-1',
      frameworkLabel: 'Jr. Acquisitions Scorecard',
      submittedBy: 'casey@savingkc.com',
      assignedReviewer: 'gertha@savingkc.com',
    })

    expect(alert.attempted).toBe(false)
    expect(mocks.safeSendSMS).not.toHaveBeenCalled()
  })
})
