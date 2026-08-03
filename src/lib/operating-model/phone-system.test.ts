import { describe, expect, it } from 'vitest'
import { TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { PHONE_SYSTEM, PHONE_SYSTEM_ATTENTION } from './phone-system'
import { WORKFLOW_CATALOG } from './workflow-catalog'

describe('master phone system', () => {
  it('registers every owned number exactly once', () => {
    expect(TWILIO_NUMBERS).toHaveLength(21)
    expect(PHONE_SYSTEM).toHaveLength(TWILIO_NUMBERS.length)
    expect(new Set(PHONE_SYSTEM.map((record) => record.number)).size).toBe(PHONE_SYSTEM.length)
    expect(PHONE_SYSTEM.map((record) => record.number).sort())
      .toEqual(TWILIO_NUMBERS.map((record) => record.value).sort())
  })

  it('links every phone identity to a registered workflow and complete path', () => {
    const workflowIds = new Set(WORKFLOW_CATALOG.map((workflow) => workflow.id))
    for (const record of PHONE_SYSTEM) {
      expect(workflowIds.has(record.workflowId), record.label).toBe(true)
      expect(record.inboundPath.length, record.label).toBeGreaterThanOrEqual(3)
      expect(record.answeredPath, record.label).not.toBe('')
      expect(record.noAnswerPath, record.label).not.toBe('')
      expect(record.smsPath, record.label).not.toBe('')
      expect(record.smsSenderPolicy, record.label).not.toBe('')
      expect(record.outboundUse, record.label).not.toBe('')
      expect(record.carrierFallback, record.label).not.toBe('')
      expect(record.sourceFiles.length, record.label).toBeGreaterThan(0)
    }
  })

  it('routes the dispositions and Casey legacy identities directly to their owners', () => {
    expect(PHONE_SYSTEM_ATTENTION).toEqual([])
    expect(PHONE_SYSTEM.find((record) => record.number === '+18166088858')).toMatchObject({
      owner: 'Ernest', routeType: 'dispositions', health: 'healthy',
    })
    expect(PHONE_SYSTEM.find((record) => record.number === '+18163754666')).toMatchObject({
      owner: 'Casey', routeType: 'legacy', health: 'healthy',
    })
  })
})
