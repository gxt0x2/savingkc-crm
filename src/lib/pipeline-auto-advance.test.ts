import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  apply: vi.fn(),
  qualification: vi.fn(),
  conversion: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}))
vi.mock('@/lib/server/crm-lifecycle', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/crm-lifecycle')>(),
  applyCrmLifecycleCommand: mocks.apply,
}))
vi.mock('@/lib/qualification-policy', () => ({ getLeadQualificationStatus: mocks.qualification }))
vi.mock('@/lib/ppc/qualified-lead-conversion', () => ({ queuePpcQualifiedLeadConversion: mocks.conversion }))

import { checkAutoAdvance } from './pipeline-auto-advance'

function leadQuery(lead: { id: string; station: string | null } | null, error: { message: string } | null = null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: lead, error }),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  mocks.from.mockReturnValue(query)
  return query
}

describe('canonical pipeline auto advance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.qualification.mockResolvedValue({ qualified: true, missing: [] })
    mocks.conversion.mockResolvedValue({ queued: true })
    mocks.apply.mockImplementation(async (input) => ({
      eventId: 'event-1', leadId: input.leadId, stage: input.stage,
      classification: 'lead', priority: 'warm', owner: null, deadReason: null,
      fromStage: 'new', replayed: false,
    }))
  })

  it('moves first contact through the canonical audited lifecycle command', async () => {
    const query = leadQuery({ id: 'lead-1', station: 'new' })
    await expect(checkAutoAdvance('lead-1', 'outbound_contact')).resolves.toEqual({
      advanced: true, from: 'new', to: 'contacted',
    })
    expect(query.select).toHaveBeenCalledWith('id,station')
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1', commandType: 'transition', stage: 'contacted',
      actorEmail: 'automation@savingkc.com', actorName: 'CRM Automation',
    }))
  })

  it('revalidates protected control immediately before the lifecycle mutation', async () => {
    leadQuery({ id: 'lead-1', station: 'new' })
    const beforeMutation = vi.fn().mockResolvedValue(undefined)

    await checkAutoAdvance('lead-1', 'outbound_contact', { beforeMutation })

    expect(beforeMutation).toHaveBeenCalledOnce()
    expect(beforeMutation.mock.invocationCallOrder[0]).toBeLessThan(mocks.apply.mock.invocationCallOrder[0])
  })

  it('suppresses the lifecycle mutation when protected control was lost', async () => {
    leadQuery({ id: 'lead-1', station: 'new' })
    const beforeMutation = vi.fn().mockRejectedValue(new Error('Dialing control moved'))

    await expect(checkAutoAdvance('lead-1', 'outbound_contact', { beforeMutation }))
      .rejects.toThrow('Dialing control moved')
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.conversion).not.toHaveBeenCalled()
  })

  it('does not qualify a lead without four human-verified pillars', async () => {
    leadQuery({ id: 'lead-1', station: 'contacted' })
    mocks.qualification.mockResolvedValue({ qualified: false, missing: ['PRICE'] })
    await expect(checkAutoAdvance('lead-1', 'appointment_completed')).resolves.toEqual({ advanced: false })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('carries recorded signed-contract evidence into the Dispositions handoff', async () => {
    leadQuery({ id: 'lead-1', station: 'offer_made' })
    mocks.apply.mockResolvedValue({
      eventId: 'event-2', leadId: 'lead-1', stage: 'under_contract',
      classification: 'opportunity', priority: 'hot', owner: 'Casey', deadReason: null,
      fromStage: 'offer_made', replayed: false,
    })
    await expect(checkAutoAdvance('lead-1', 'contract_signed')).resolves.toEqual({
      advanced: true, from: 'offer_made', to: 'under_contract',
    })
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      evidenceType: 'seller_contract_signed',
      evidenceReference: 'pipeline-trigger:contract_signed',
    }))
  })

  it('does not create a second transition when the trigger does not advance the current stage', async () => {
    leadQuery({ id: 'lead-1', station: 'appointment_set' })
    await expect(checkAutoAdvance('lead-1', 'outbound_contact')).resolves.toEqual({ advanced: false })
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.conversion).not.toHaveBeenCalled()
  })

  it('fails closed when the canonical lead record cannot be read', async () => {
    leadQuery(null, { message: 'database unavailable' })
    await expect(checkAutoAdvance('lead-1', 'outbound_contact')).rejects.toThrow('Lifecycle record unavailable')
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})
