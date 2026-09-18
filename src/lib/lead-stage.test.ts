import { describe, expect, it } from 'vitest'

import {
  LEAD_WORKSPACE_STAGES,
  leadWorkspaceStageIndex,
  leadWorkspaceStageLabel,
  resolveLeadWorkspaceStage,
} from './lead-stage'

describe('lead workspace stage model', () => {
  it('keeps New as the current stage until the canonical record advances', () => {
    expect(leadWorkspaceStageIndex('new')).toBe(0)
    expect(leadWorkspaceStageLabel('new')).toBe('New')
  })

  it('includes Appointment set between Opportunity and Offer', () => {
    expect(LEAD_WORKSPACE_STAGES.map((stage) => stage.label)).toEqual([
      'New',
      'Contacted',
      'Opportunity',
      'Appointment set',
      'Offer',
      'Contract',
    ])
    expect(leadWorkspaceStageIndex('appointment_set')).toBe(3)
    expect(leadWorkspaceStageIndex('offer_made')).toBe(4)
  })

  it('maps historical aliases without promoting an unknown stage to New', () => {
    expect(leadWorkspaceStageIndex('appt_set')).toBe(3)
    expect(leadWorkspaceStageIndex('unexpected_stage')).toBe(-1)
    expect(leadWorkspaceStageLabel('unexpected_stage')).toBe('unexpected stage')
  })

  it('shows Appointment set when a governed appointment is ahead of a stale early stage', () => {
    expect(resolveLeadWorkspaceStage('new', true)).toEqual({
      index: 3,
      label: 'Appointment set',
      appointmentDerived: true,
    })
    expect(resolveLeadWorkspaceStage('contacted', true).index).toBe(3)
    expect(resolveLeadWorkspaceStage('qualified', true).index).toBe(3)
  })

  it('never lets an appointment move an offer or contract backward', () => {
    expect(resolveLeadWorkspaceStage('offer_made', true).index).toBe(4)
    expect(resolveLeadWorkspaceStage('under_contract', true).index).toBe(5)
  })
})
