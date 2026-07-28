import { describe, expect, it } from 'vitest'
import { GOOGLE_ADS_TWILIO_NUMBER } from '@/lib/twilio-numbers'
import { WORKFLOW_CATALOG, validateWorkflowDefinition } from './workflow-catalog'
import type { WorkflowDefinition } from './types'

describe('workflow operating model', () => {
  it('ships only valid catalog definitions', () => {
    for (const workflow of WORKFLOW_CATALOG) {
      expect(validateWorkflowDefinition(workflow), workflow.name).toEqual([])
    }
  })

  it('requires protected Google Ads call-flow resources', () => {
    const unsafeWorkflow: WorkflowDefinition = {
      ...WORKFLOW_CATALOG[0],
      id: 'unsafe-copy',
      protectedResources: [],
      trigger: { type: 'inbound_call', phoneNumber: GOOGLE_ADS_TWILIO_NUMBER },
    }

    expect(validateWorkflowDefinition(unsafeWorkflow)).toContainEqual({
      severity: 'error',
      code: 'PROTECTED_PHONE_REQUIRED',
      message: 'Google Ads phone workflows must declare the inbound number as a protected resource.',
    })
  })
})
