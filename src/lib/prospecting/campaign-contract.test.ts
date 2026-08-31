import { describe, expect, it } from 'vitest'
import {
  ProspectingCampaignInputError,
  type ProspectingCampaignDetail,
  PROSPECTING_LIVE_TAX_3_PLUS_CAMPAIGN_ID,
  PROSPECTING_PILOT_CAMPAIGN_ID,
  assertProspectingFactoryCampaignSpec,
  copyProspectingCampaignSetup,
  countySavedViewFactoryListError,
  countyOwnerStatusFiltersForListType,
  editableProspectingCampaignSetup,
  factoryListRowMixError,
  isProspectingDialerPickerCampaign,
  preferredProspectingDialerPickerCampaignId,
  prospectingCampaignListType,
  prospectingCampaignListTypeForCampaign,
  prospectingDialerPickerCampaigns,
  prospectingDialerPickerLabel,
  prospectingFactoryCampaignNameError,
  isWithinProspectingWindow,
  nextProspectingWindow,
  parseCreateProspectingCampaignInput,
  parseCountyParcelIds,
  parseLeadIds,
  parsePastedCountyParcelIds,
  parseProspectingDialerSessionSetup,
  renderProspectingTemplate,
} from './campaign-contract'

describe('prospecting campaign contract', () => {
  it('copies setup into a clean draft contract without audience or activity state', () => {
    const campaign: ProspectingCampaignDetail = {
      id: 'campaign-1', name: 'August Absentee', kind: 'sms' as const, status: 'active' as const, ownerEmail: 'ernest@savingkc.com', ownerName: 'Ernest', callerId: null, fromPhone: '+18163077835', defaultTimezone: 'America/Chicago', sendWindowStart: '09:00', sendWindowEnd: '19:00', sendDays: [1, 2, 3, 4, 5, 6], perHour: 75, perDay: 500, createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T11:00:00.000Z', activatedAt: '2026-08-21T11:00:00.000Z', pausedAt: null, completedAt: null,
      steps: [{ id: 'step-1', position: 1, delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}' }],
      members: [{ id: 'member-1', subjectKind: 'lead', leadId: 'lead-1', prospectId: null, enrollmentSource: 'crm_lead', phone: '+18165550123', timezone: 'America/Chicago', status: 'active', suppressionReason: null, currentStepPosition: 1, nextActionAt: null, enrolledAt: '2026-08-21T10:30:00.000Z', readyContactCount: 1, suppressedContactCount: 0, lead: null }],
      stats: { total: 1, active: 1, needsReview: 0, suppressed: 0, replied: 0, completed: 0, sent: 0, delivered: 0, failed: 0 },
      operations: { queued: 0, processing: 0, nextActionAt: null, lastSentAt: null },
    }
    const copy = copyProspectingCampaignSetup(campaign)
    expect(copy).toEqual({ name: 'August Absentee copy', kind: 'sms', callerId: null, fromPhone: '+18163077835', defaultTimezone: 'America/Chicago', sendWindowStart: '09:00', sendWindowEnd: '19:00', sendDays: [1, 2, 3, 4, 5, 6], perHour: 75, perDay: 500, steps: [{ delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}' }] })
    expect(copy).not.toHaveProperty('members')
    expect(copy).not.toHaveProperty('stats')
    expect(copy.steps).not.toBe(campaign.steps)
    expect(editableProspectingCampaignSetup(campaign)).toEqual({ ...copy, name: 'August Absentee' })
  })

  it('accepts a bounded SMS sequence and normalizes its sender', () => {
    expect(parseCreateProspectingCampaignInput({
      name: 'August absentee owners',
      kind: 'sms',
      fromPhone: '(816) 307-7835',
      defaultTimezone: 'America/Chicago',
      sendWindowStart: '10:00',
      sendWindowEnd: '18:00',
      sendDays: [1, 2, 3, 4, 5],
      perHour: 75,
      perDay: 500,
      steps: [
        { delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}, would you consider an offer?' },
        { delayMinutes: 1440, bodyTemplate: 'Just following up, {{first_name}}.' },
      ],
    })).toMatchObject({
      kind: 'sms',
      fromPhone: '+18163077835',
      callerId: null,
      sendWindowStart: '10:00',
      sendWindowEnd: '18:00',
      sendDays: [1, 2, 3, 4, 5],
      steps: [{ delayMinutes: 0 }, { delayMinutes: 1440 }],
    })
  })

  it('rejects an empty or reversed local send schedule', () => {
    const campaign = {
      name: 'Invalid schedule', kind: 'sms', fromPhone: '+18163077835',
      steps: [{ delayMinutes: 0, bodyTemplate: 'Hello' }],
    }
    expect(() => parseCreateProspectingCampaignInput({ ...campaign, sendDays: [] })).toThrow(/at least one send day/)
    expect(() => parseCreateProspectingCampaignInput({ ...campaign, sendWindowStart: '19:00', sendWindowEnd: '09:00' })).toThrow(/valid local-time window/)
  })

  it('requires a calling number for an honest dialer campaign', () => {
    expect(() => parseCreateProspectingCampaignInput({ name: 'Cold list', kind: 'dialer' }))
      .toThrowError(new ProspectingCampaignInputError('caller_id_required', 'Choose an approved calling number'))
  })

  it('requires a registered campaign sender even when the phone is syntactically valid', () => {
    expect(() => parseCreateProspectingCampaignInput({
      name: 'Unknown sender', kind: 'sms', fromPhone: '+19135550123',
      steps: [{ delayMinutes: 0, bodyTemplate: 'Hello' }],
    })).toThrow(/approved texting number/)
  })

  it('accepts only one to five designated cold-call caller IDs for a session', () => {
    expect(parseProspectingDialerSessionSetup({
      startBehavior: 'first_unworked',
      callerMode: 'rotation',
      callerIds: ['(816) 310-0845', '+18162538313'],
      ringCount: 5,
      notDialedHours: 72,
      notContactedHours: 168,
    })).toEqual({
      startBehavior: 'first_unworked',
      callerMode: 'rotation',
      callerIds: ['+18163100845', '+18162538313'],
      ringCount: 5,
      notDialedHours: 72,
      notContactedHours: 168,
    })
    expect(() => parseProspectingDialerSessionSetup({
      callerMode: 'static',
      callerIds: ['+18166088588'],
      ringCount: 7,
    })).toThrow(/only designated cold-call numbers/i)
    expect(() => parseProspectingDialerSessionSetup({
      callerMode: 'rotation',
      callerIds: Array.from({ length: 6 }, (_, index) => `+1816310084${index}`),
      ringCount: 7,
    })).toThrow(/between 1 and 5/i)
  })

  it('defaults safely without hiding fresh sellers', () => {
    expect(parseProspectingDialerSessionSetup({})).toMatchObject({
      startBehavior: 'resume',
      callerMode: 'static',
      callerIds: ['+18163100845'],
      ringCount: 7,
      notDialedHours: null,
      notContactedHours: null,
    })
  })

  it('renders both campaign and legacy variables and rejects unknown placeholders', () => {
    expect(renderProspectingTemplate(
      'Hi {{first_name}}, this is {{agent_name}} about {{property_address}}.',
      { fullName: 'Alex Seller', propertyAddress: '1 Main St', agentName: 'Casey' },
    )).toBe('Hi Alex, this is Casey about 1 Main St.')
    expect(renderProspectingTemplate('Hi {{mystery_field}}', { agentName: 'Casey' })).toBeNull()
  })

  it('rejects duplicate or malformed member ids', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(() => parseLeadIds([id, id])).toThrow(/valid contacts/)
    expect(() => parseLeadIds(['not-a-uuid'])).toThrow(/valid contacts/)
  })

  it('accepts a unique pasted Jackson parcel list and rejects a drifted set', () => {
    expect(parsePastedCountyParcelIds('SYN-JACKSON-PARCEL-0001\nSYN-JACKSON-PARCEL-0002, SYN-JACKSON-PARCEL-0001'))
      .toEqual(['SYN-JACKSON-PARCEL-0001', 'SYN-JACKSON-PARCEL-0002'])
    expect(() => parseCountyParcelIds(['SYN-JACKSON-PARCEL-0001', 'SYN-JACKSON-PARCEL-0001'])).toThrow(/unique Jackson parcel/)
    expect(() => parseCountyParcelIds([])).toThrow(/unique Jackson parcel/)
  })

  it('hides draft campaigns and names containing Pilot from the live dialer picker', () => {
    const live = { id: '74609ed4-7e26-4111-b626-b2e3f68efa0b', name: 'Jackson · Tax 3+ · 7 zips · Aug 30', kind: 'dialer', status: 'active' }
    const pilot = { id: '5c45d2f7-c120-4477-bb1f-f04d69c4efdf', name: 'County Tax Delinquent 2-Year — Pilot', kind: 'dialer', status: 'active' }
    const draft = { id: '8d94a8d6-e3cd-4ab7-983c-44efcf8c92a2', name: 'August Absentee', kind: 'dialer', status: 'draft' }

    expect(isProspectingDialerPickerCampaign(live)).toBe(true)
    expect(isProspectingDialerPickerCampaign(pilot)).toBe(false)
    expect(isProspectingDialerPickerCampaign(draft)).toBe(false)
    expect(prospectingDialerPickerCampaigns([pilot, draft, live])).toEqual([live])
    expect(prospectingDialerPickerLabel(live)).toBe('Jackson · Tax 3+ · 7 zips · Aug 30')
    expect(prospectingDialerPickerLabel(live)).not.toMatch(/Casey/i)
    expect(prospectingDialerPickerLabel(live)).not.toMatch(/active/i)
    expect(prospectingDialerPickerLabel(live)).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(preferredProspectingDialerPickerCampaignId([pilot, draft, live])).toBe(live.id)
    expect(preferredProspectingDialerPickerCampaignId([pilot, draft, live], null, draft.id)).toBe(draft.id)
    expect(isProspectingDialerPickerCampaign({
      id: PROSPECTING_PILOT_CAMPAIGN_ID,
      name: 'County Tax Delinquent 2-Year',
      kind: 'dialer',
      status: 'active',
    })).toBe(false)
  })

  it('locks Tax 3+ and Deceased factory titles to one pile and voice only', () => {
    expect(prospectingCampaignListType('Jackson · Tax 3+ · 7 zips · Aug 30')).toBe('tax_3_plus')
    expect(prospectingCampaignListType('Jackson · Deceased · heirs · Aug 30')).toBe('deceased')
    expect(prospectingCampaignListType('August Absentee')).toBeNull()
    expect(prospectingCampaignListTypeForCampaign({
      id: PROSPECTING_LIVE_TAX_3_PLUS_CAMPAIGN_ID,
      name: 'Jackson renamed cut',
    })).toBe('tax_3_plus')
    expect(prospectingFactoryCampaignNameError('Jackson · Tax 3+ · Deceased · Aug 30')).toBe('campaign_list_piles_mixed')
    expect(prospectingFactoryCampaignNameError('Casey · Jackson · Tax 3+ · 7 zips · Aug 30')).toBe('campaign_name_excludes_caller')
    expect(countyOwnerStatusFiltersForListType('tax_3_plus')).toEqual(['non_deceased'])
    expect(countySavedViewFactoryListError({
      campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30',
      savedView: 'tax_3yr_plus',
      deceasedFilter: 'deceased',
    })).toBe('tax_3_plus_excludes_deceased')
    expect(countySavedViewFactoryListError({
      campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30',
      savedView: 'tax_2yr',
      deceasedFilter: 'non_deceased',
    })).toBe('tax_3_plus_requires_tax_3yr_plus_view')
    expect(factoryListRowMixError({
      campaignId: PROSPECTING_LIVE_TAX_3_PLUS_CAMPAIGN_ID,
      campaignName: 'Jackson · Tax 3+ · 7 zips · Aug 30',
      deceasedCount: 1,
      livingCount: 2,
    })).toBe('tax_3_plus_excludes_deceased')
    expect(() => assertProspectingFactoryCampaignSpec('Jackson · Tax 3+ · 7 zips · Aug 30', 'sms'))
      .toThrowError(new ProspectingCampaignInputError('factory_list_voice_only', 'Tax 3+ and Deceased factory lists are voice only'))
    expect(() => parseCreateProspectingCampaignInput({
      name: 'Jackson · Tax 3+ · Deceased · Aug 30',
      kind: 'dialer',
      callerId: '+18163100845',
    })).toThrow(/separate piles/)
    expect(parseCreateProspectingCampaignInput({
      name: 'Jackson · Tax 3+ · 7 zips · Aug 30',
      kind: 'dialer',
      callerId: '+18163100845',
    })).toMatchObject({ name: 'Jackson · Tax 3+ · 7 zips · Aug 30', kind: 'dialer' })
  })

  it('checks the member timezone instead of the server timezone', () => {
    const window = {
      timezone: 'America/Chicago',
      sendWindowStart: '09:00:00',
      sendWindowEnd: '19:00:00',
      sendDays: [1, 2, 3, 4, 5, 6],
    }
    expect(isWithinProspectingWindow(new Date('2026-08-21T15:00:00.000Z'), window)).toBe(true)
    expect(isWithinProspectingWindow(new Date('2026-08-22T01:00:00.000Z'), window)).toBe(false)
    expect(nextProspectingWindow(new Date('2026-08-22T01:00:00.000Z'), window).toISOString())
      .toBe('2026-08-22T14:00:00.000Z')
  })
})
