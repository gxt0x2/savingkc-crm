import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ user: vi.fn(), scoped: vi.fn(), lead: vi.fn(), canRead: vi.fn(), companyWide: vi.fn(), row: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/auth')>(), requireMobileUser: mocks.user }))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(),
  resolveMobileScopedActor: mocks.scoped, requireAuthorizedMobileLead: mocks.lead,
  mobileActorCanReadAssignedLead: mocks.canRead,
}))
vi.mock('@/lib/assistant/auth', async (original) => ({ ...await original<typeof import('@/lib/assistant/auth')>(), assistantActorCanReadCompanyWide: mocks.companyWide }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.row }) }) }) }) }))

import { requireAuthorizedMobileAppointment, requireAuthorizedMobileWorkItem, requireMobileCommandActor } from './mobile-command-access'

const request = new Request('https://crm.savingkc.com/api/mobile/v1/work-items', { headers: { Authorization: 'Bearer test' } })
const actor = { email: 'casey@savingkc.com', fullName: 'Casey', assignmentAliases: ['Casey'] }

describe('mobile command actor scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ user: { email: actor.email } })
    mocks.scoped.mockResolvedValue(actor)
    mocks.companyWide.mockReturnValue(false)
    mocks.canRead.mockImplementation((_actor: unknown, assigned: string) => assigned === 'Casey')
  })

  it('fails closed for an authenticated but unregistered CRM actor', async () => {
    mocks.scoped.mockResolvedValue(null)
    await expect(requireMobileCommandActor(request)).rejects.toMatchObject({ status: 403 })
    expect(mocks.row).not.toHaveBeenCalled()
  })

  it('authorizes an appointment only through its canonical lead', async () => {
    mocks.row.mockResolvedValue({ data: { id: 'appointment-1', lead_id: 'lead-1' }, error: null })
    mocks.lead.mockRejectedValue({ status: 403 })
    await expect(requireAuthorizedMobileAppointment(request, 'appointment-1')).rejects.toMatchObject({ status: 403 })
    expect(mocks.lead).toHaveBeenCalledWith(request, 'lead-1')
  })

  it('authorizes a standalone event through immutable actor ownership without lead access', async () => {
    mocks.row.mockResolvedValue({ data: { id: 'event-1', lead_id: null, assigned_to: 'Ernest', mobile_appointment_calendar_sync: [{ owner_email: actor.email }] }, error: null })
    await expect(requireAuthorizedMobileAppointment(request, 'event-1')).resolves.toMatchObject({ leadId: null })
    expect(mocks.lead).not.toHaveBeenCalled()
  })

  it('rejects another owner even for company-wide readers or the event assignee', async () => {
    mocks.companyWide.mockReturnValue(true)
    mocks.row.mockResolvedValue({ data: { id: 'event-1', lead_id: null, assigned_to: 'Casey', mobile_appointment_calendar_sync: [{ owner_email: 'ernest@savingkc.com' }] }, error: null })
    await expect(requireAuthorizedMobileAppointment(request, 'event-1')).rejects.toMatchObject({ status: 403 })
  })

  it('rejects unlinked work assigned to someone else', async () => {
    mocks.row.mockResolvedValue({ data: { work_item_key: 'activity:task-1', lead_id: null, assigned_to: 'Ernest' }, error: null })
    await expect(requireAuthorizedMobileWorkItem(request, 'activity:task-1')).rejects.toMatchObject({ status: 403 })
  })

  it('allows exact own assignment without a linked lead', async () => {
    mocks.row.mockResolvedValue({ data: { work_item_key: 'activity:task-1', lead_id: null, assigned_to: 'Casey' }, error: null })
    await expect(requireAuthorizedMobileWorkItem(request, 'activity:task-1')).resolves.toMatchObject({ key: 'activity:task-1' })
  })
})
