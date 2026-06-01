import { describe, expect, it, vi } from 'vitest'
import {
  buildGoogleAdsUploadPlan,
  getPpcConversionExportConfigHealth,
  runPpcConversionExport,
  type PpcConversionOutboxExportRow,
} from './conversion-exporter'

function makeRow(overrides: Partial<PpcConversionOutboxExportRow> = {}): PpcConversionOutboxExportRow {
  return {
    id: 'outbox-1',
    event_name: 'qualified_lead',
    event_category: 'form',
    destination: 'google_ads',
    dedupe_key: 'lead:123:qualified_lead',
    approved_for_google_ads: true,
    status: 'pending',
    optimization_role: 'primary',
    lead_id: 'lead-123',
    manifest_id: 'manifest-123',
    activity_id: 'activity-123',
    conversion_value: null,
    currency: 'USD',
    event_time: '2026-05-20T23:49:40.251Z',
    click_id: 'test-gclid',
    click_id_type: 'gclid',
    attribution: { landingUrl: 'https://savingkc.com/ppc?gclid=test-gclid' },
    payload: { form_status: 'qualified', google_ads_value_basis: 'factual_stage_conversion' },
    attempts: 0,
    last_error: null,
    locked_at: null,
    sent_at: null,
    created_at: '2026-05-20T23:49:40.251Z',
    updated_at: '2026-05-20T23:49:40.251Z',
    ...overrides,
  }
}

function googleConfig() {
  return {
    apiVersion: 'v24',
    customerId: '646966429',
    loginCustomerId: null,
    developerToken: 'developer-token',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    adUserDataConsent: null,
    conversionActions: {
      qualified_lead: 'customers/646966429/conversionActions/333',
      call_connected_60s: 'customers/646966429/conversionActions/222',
    },
  } as Parameters<typeof buildGoogleAdsUploadPlan>[1]
}

describe('ppc conversion exporter', () => {
  it('summarizes Stape-only export configuration without exposing secrets', () => {
    const health = getPpcConversionExportConfigHealth({
      PPC_CONVERSION_EXPORT_DESTINATIONS: 'stape',
      PPC_STAPE_ENDPOINT_URL: 'https://gtm.savingkc.com/data',
      STAPE_SGTM_PREVIEW_HEADER: 'secret-preview-token',
    })

    expect(health).toMatchObject({
      configured: true,
      mode: 'stape_only',
      enabledDestinations: ['stape'],
      stape: {
        enabled: true,
        ready: true,
        endpointHost: 'gtm.savingkc.com',
        previewHeaderConfigured: true,
      },
      googleAds: {
        enabled: false,
        ready: false,
      },
    })
    expect(JSON.stringify(health)).not.toContain('secret-preview-token')
    expect(health.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Stape/server GTM only'),
      ]),
    )
  })

  it('reports missing Google Ads API credentials and action mappings', () => {
    const health = getPpcConversionExportConfigHealth({
      PPC_CONVERSION_EXPORT_DESTINATIONS: 'google_ads,stape',
      PPC_STAPE_ENDPOINT_URL: 'https://gtm.savingkc.com/data',
      GOOGLE_ADS_CUSTOMER_ID: '646-966-429',
      GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
      GOOGLE_ADS_CLIENT_ID: 'client-id',
      GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
      GOOGLE_ADS_CONVERSION_ACTION_QUALIFIED_LEAD: '333',
    })

    expect(health.configured).toBe(true)
    expect(health.googleAds).toMatchObject({
      enabled: true,
      ready: false,
      customerId: '646966429',
      configuredActionMappings: ['qualified_lead'],
    })
    expect(health.googleAds.missingConfig).toContain('GOOGLE_ADS_REFRESH_TOKEN or GOOGLE_ADS_REFRESH_TOKEN_USER_EMAIL')
    expect(health.googleAds.missingActionMappings).toEqual(
      expect.arrayContaining(['appointment_booked', 'call_connected_60s', 'call_connected_2m', 'call_connected_5m']),
    )
  })

  it('accepts a saved Google Ads OAuth token email as the refresh-token source', () => {
    const health = getPpcConversionExportConfigHealth({
      PPC_CONVERSION_EXPORT_DESTINATIONS: 'google_ads',
      GOOGLE_ADS_CUSTOMER_ID: '646-966-429',
      GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
      GOOGLE_ADS_CLIENT_ID: 'client-id',
      GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
      GOOGLE_ADS_REFRESH_TOKEN_USER_EMAIL: 'savingkc@gmail.com',
      GOOGLE_ADS_CONVERSION_ACTION_QUALIFIED_LEAD: '222',
      GOOGLE_ADS_CONVERSION_ACTION_APPOINTMENT_BOOKED: '333',
      GOOGLE_ADS_CONVERSION_ACTION_CALL_CONNECTED_60S: '444',
      GOOGLE_ADS_CONVERSION_ACTION_CALL_CONNECTED_2M: '555',
      GOOGLE_ADS_CONVERSION_ACTION_CALL_CONNECTED_5M: '666',
    })

    expect(health.googleAds.missingConfig).toEqual([])
    expect(health.googleAds.ready).toBe(true)
  })

  it('builds Google Ads click conversion payloads with exactly one click id', () => {
    const plan = buildGoogleAdsUploadPlan(makeRow(), googleConfig())

    expect(plan.kind).toBe('click')
    if (plan.kind !== 'click') throw new Error('Expected click upload plan')
    expect(plan.conversion).toMatchObject({
      conversionAction: 'customers/646966429/conversionActions/333',
      gclid: 'test-gclid',
      conversionDateTime: '2026-05-20 23:49:40+00:00',
      conversionValue: 1,
      currencyCode: 'USD',
      orderId: 'lead:123:qualified_lead',
    })
    expect(plan.conversion).not.toHaveProperty('gbraid')
    expect(plan.conversion).not.toHaveProperty('wbraid')
  })

  it('builds Google Ads click conversion payloads from user identifiers when click id is missing', () => {
    const identifiers = [
      {
        userIdentifierSource: 'FIRST_PARTY' as const,
        hashedEmail: 'a'.repeat(64),
      },
      {
        userIdentifierSource: 'FIRST_PARTY' as const,
        hashedPhoneNumber: 'b'.repeat(64),
      },
    ]
    const plan = buildGoogleAdsUploadPlan(
      makeRow({
        click_id: null,
        click_id_type: null,
        payload: {
          form_status: 'qualified',
          google_ads_value_basis: 'factual_stage_conversion',
          user_identifiers: identifiers,
        },
      }),
      googleConfig(),
    )

    expect(plan.kind).toBe('click')
    if (plan.kind !== 'click') throw new Error('Expected click upload plan')
    expect(plan.conversion).toMatchObject({
      conversionAction: 'customers/646966429/conversionActions/333',
      conversionValue: 1,
      orderId: 'lead:123:qualified_lead',
      userIdentifiers: identifiers,
    })
    expect(plan.conversion).not.toHaveProperty('gclid')
    expect(plan.conversion).not.toHaveProperty('gbraid')
    expect(plan.conversion).not.toHaveProperty('wbraid')
  })

  it('skips primary rows only when both click id and user identifiers are missing', () => {
    const plan = buildGoogleAdsUploadPlan(
      makeRow({
        click_id: null,
        click_id_type: null,
      }),
      googleConfig(),
    )

    expect(plan.kind).toBe('skip')
    if (plan.kind !== 'skip') throw new Error('Expected skip upload plan')
    expect(plan.hardFailure).toBe(true)
    expect(plan.reason).toContain('No click id or user identifiers')
  })

  it('keeps final form submits out of offline Google Ads API uploads', () => {
    const row = makeRow({
      event_name: 'lead_submitted',
      event_category: 'form',
      optimization_role: 'primary',
      dedupe_key: 'lead:123:lead_submitted',
      payload: { form_status: 'submitted', google_ads_quality_score: 2 },
    })

    const plan = buildGoogleAdsUploadPlan(row, googleConfig())

    expect(plan.kind).toBe('skip')
    if (plan.kind !== 'skip') throw new Error('Expected skip upload plan')
    expect(plan.hardFailure).toBe(false)
    expect(plan.reason).toContain('website/GTM primary conversion')
  })

  it('marks stale final form submit rows skipped instead of exporting them', async () => {
    const row = makeRow({
      event_name: 'lead_submitted',
      event_category: 'form',
      approved_for_google_ads: false,
      optimization_role: 'primary',
      dedupe_key: 'lead:123:lead_submitted',
      payload: { form_status: 'submitted', google_ads_quality_score: 2 },
    })
    const store = {
      listRows: vi.fn(),
      claimRows: vi.fn(async () => [row]),
      markSent: vi.fn(),
      markSkipped: vi.fn(),
      markFailed: vi.fn(),
    }
    const fetchMock = vi.fn()

    const result = await runPpcConversionExport(
      {
        env: {
          PPC_CONVERSION_EXPORT_DESTINATIONS: 'google_ads,stape',
          PPC_STAPE_ENDPOINT_URL: 'https://gtm.savingkc.com/data',
          GOOGLE_ADS_CUSTOMER_ID: '646966429',
          GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
          GOOGLE_ADS_CLIENT_ID: 'client-id',
          GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
          GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
          GOOGLE_ADS_CONVERSION_ACTIONS_JSON: JSON.stringify({
            qualified_lead: 'customers/646966429/conversionActions/333',
          }),
        },
      },
      { store, fetch: fetchMock as unknown as typeof fetch },
    )

    expect(result.skipped).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.markSkipped).toHaveBeenCalledWith(
      row,
      expect.stringContaining('website/GTM primary conversion'),
      expect.objectContaining({
        destinations: expect.arrayContaining([
          expect.objectContaining({ destination: 'google_ads', status: 'skipped' }),
          expect.objectContaining({ destination: 'stape', status: 'skipped' }),
        ]),
      }),
      expect.any(Date),
    )
  })

  it('builds Google Ads call conversion payloads from call metadata', () => {
    const row = makeRow({
      event_name: 'call_connected_60s',
      event_category: 'call',
      optimization_role: 'secondary',
      click_id: null,
      click_id_type: null,
      conversion_value: 1,
      payload: {
        from: '(816) 555-1212',
        duration: 70,
      },
    })

    const plan = buildGoogleAdsUploadPlan(row, googleConfig())

    expect(plan.kind).toBe('call')
    if (plan.kind !== 'call') throw new Error('Expected call upload plan')
    expect(plan.conversion).toMatchObject({
      conversionAction: 'customers/646966429/conversionActions/222',
      callerId: '+18165551212',
      callStartDateTime: '2026-05-20 23:48:30+00:00',
      conversionDateTime: '2026-05-20 23:49:40+00:00',
      conversionValue: 1,
      currencyCode: 'USD',
    })
  })

  it('does not mutate rows in dry-run mode', async () => {
    const row = makeRow()
    const store = {
      listRows: vi.fn(async () => [row]),
      claimRows: vi.fn(async () => {
        throw new Error('dry run should not claim rows')
      }),
      markSent: vi.fn(),
      markSkipped: vi.fn(),
      markFailed: vi.fn(),
    }

    const result = await runPpcConversionExport(
      {
        dryRun: true,
        env: {
          PPC_CONVERSION_EXPORT_DESTINATIONS: 'stape',
          PPC_STAPE_ENDPOINT_URL: 'https://gtm.savingkc.com/data',
        },
      },
      { store },
    )

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      configured: true,
      scanned: 1,
      claimed: 0,
      pending: 1,
      missingConfig: [],
    })
    expect(store.listRows).toHaveBeenCalledOnce()
    expect(store.claimRows).not.toHaveBeenCalled()
    expect(store.markSent).not.toHaveBeenCalled()
  })

  it('sends rows to Stape and marks them sent', async () => {
    const row = makeRow()
    const store = {
      listRows: vi.fn(),
      claimRows: vi.fn(async () => [row]),
      markSent: vi.fn(),
      markSkipped: vi.fn(),
      markFailed: vi.fn(),
    }
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))

    const result = await runPpcConversionExport(
      {
        env: {
          PPC_CONVERSION_EXPORT_DESTINATIONS: 'stape',
          PPC_STAPE_ENDPOINT_URL: 'https://gtm.savingkc.com/data',
        },
      },
      { store, fetch: fetchMock as unknown as typeof fetch },
    )

    expect(result.sent).toBe(1)
    expect(store.markSent).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    const [url, init] = calls[0]
    expect(String(url)).toContain('https://gtm.savingkc.com/data')
    expect(String(url)).toContain('event_name=qualified_lead')
    expect(init?.headers).toMatchObject({ Origin: 'https://savingkc.com' })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      event_name: 'qualified_lead',
      event_id: 'outbox-1',
      value: 1,
      currency: 'USD',
      gclid: 'test-gclid',
    })
  })

  it('sends property tax campaign context to Stape', async () => {
    const row = makeRow({
      attribution: { landingUrl: 'https://savingkc.com/ppc-tax?gclid=tax-gclid' },
      click_id: 'tax-gclid',
      payload: { form_status: 'qualified' },
    })
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))

    await runPpcConversionExport(
      {
        env: {
          PPC_CONVERSION_EXPORT_DESTINATIONS: 'stape',
          PPC_STAPE_ENDPOINT_URL: 'https://gtm.savingkc.com/data',
        },
      },
      {
        store: {
          listRows: vi.fn(),
          claimRows: vi.fn(async () => [row]),
          markSent: vi.fn(),
          markSkipped: vi.fn(),
          markFailed: vi.fn(),
        },
        fetch: fetchMock as unknown as typeof fetch,
      },
    )

    const [, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      campaign: 'Search - Property Tax',
      page_path: '/ppc-tax',
      page_location: 'https://savingkc.com/ppc-tax?gclid=tax-gclid',
    })
  })

  it('exports factual qualified leads without manual 1-3 approval', async () => {
    const row = makeRow({ approved_for_google_ads: false, conversion_value: null })
    const store = {
      listRows: vi.fn(),
      claimRows: vi.fn(async () => [row]),
      markSent: vi.fn(),
      markSkipped: vi.fn(),
      markFailed: vi.fn(),
    }
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))

    const result = await runPpcConversionExport(
      {
        env: {
          PPC_CONVERSION_EXPORT_DESTINATIONS: 'stape',
          PPC_STAPE_ENDPOINT_URL: 'https://gtm.savingkc.com/data',
        },
      },
      { store, fetch: fetchMock as unknown as typeof fetch },
    )

    expect(result.sent).toBe(1)
    expect(store.markSent).toHaveBeenCalledOnce()
    expect(store.markSkipped).not.toHaveBeenCalled()
    expect(store.markFailed).not.toHaveBeenCalled()
  })

  it('validates Google Ads uploads without claiming or mutating rows', async () => {
    const row = makeRow()
    const store = {
      listRows: vi.fn(async () => [row]),
      claimRows: vi.fn(async () => {
        throw new Error('validate-only should not claim rows')
      }),
      markSent: vi.fn(),
      markSkipped: vi.fn(),
      markFailed: vi.fn(),
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{}] }), { status: 200 }))

    const result = await runPpcConversionExport(
      {
        validateOnly: true,
        env: {
          PPC_CONVERSION_EXPORT_DESTINATIONS: 'google_ads,stape',
          PPC_STAPE_ENDPOINT_URL: 'https://gtm.savingkc.com/data',
          GOOGLE_ADS_CUSTOMER_ID: '646966429',
          GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
          GOOGLE_ADS_CLIENT_ID: 'client-id',
          GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
          GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
          GOOGLE_ADS_CONVERSION_ACTION_QUALIFIED_LEAD: '333',
        },
      },
      { store, fetch: fetchMock as unknown as typeof fetch },
    )

    expect(result).toMatchObject({
      ok: true,
      dryRun: false,
      scanned: 1,
      claimed: 0,
      sent: 0,
      pending: 1,
    })
    expect(store.listRows).toHaveBeenCalledOnce()
    expect(store.claimRows).not.toHaveBeenCalled()
    expect(store.markSent).not.toHaveBeenCalled()
    expect(store.markSkipped).not.toHaveBeenCalled()
    expect(store.markFailed).not.toHaveBeenCalled()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const googleCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(String(googleCall[0])).toContain(':uploadClickConversions')
    expect(JSON.parse(String(googleCall[1].body))).toMatchObject({
      validateOnly: true,
    })
    expect(result.results[0]?.destinations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ destination: 'stape', status: 'would_send' }),
        expect.objectContaining({ destination: 'google_ads', status: 'would_send' }),
      ]),
    )
  })

  it('skips rows explicitly marked as waiting on approval', async () => {
    const row = makeRow({ approved_for_google_ads: false, payload: { approval_required: true } })
    const store = {
      listRows: vi.fn(),
      claimRows: vi.fn(async () => [row]),
      markSent: vi.fn(),
      markSkipped: vi.fn(),
      markFailed: vi.fn(),
    }
    const fetchMock = vi.fn()

    const result = await runPpcConversionExport(
      {
        env: {
          PPC_CONVERSION_EXPORT_DESTINATIONS: 'stape',
          PPC_STAPE_ENDPOINT_URL: 'https://gtm.savingkc.com/data',
        },
      },
      { store, fetch: fetchMock as unknown as typeof fetch },
    )

    expect(result.skipped).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.markSkipped).toHaveBeenCalledWith(
      row,
      'Awaiting approval for Google Ads export',
      expect.objectContaining({
        destinations: expect.arrayContaining([
          expect.objectContaining({ destination: 'stape', status: 'skipped' }),
        ]),
      }),
      expect.any(Date),
    )
  })

  it('blocks approval-required exports that are missing a 1-3 quality score', async () => {
    const row = makeRow({
      conversion_value: 25,
      payload: { approval_required: true },
    })
    const plan = buildGoogleAdsUploadPlan(row, googleConfig())

    expect(plan.kind).toBe('skip')
    if (plan.kind !== 'skip') throw new Error('Expected skip upload plan')
    expect(plan.reason).toContain('quality score of 1, 2, or 3')

    const store = {
      listRows: vi.fn(),
      claimRows: vi.fn(async () => [row]),
      markSent: vi.fn(),
      markSkipped: vi.fn(),
      markFailed: vi.fn(),
    }
    const fetchMock = vi.fn()

    const result = await runPpcConversionExport(
      {
        env: {
          PPC_CONVERSION_EXPORT_DESTINATIONS: 'stape',
          PPC_STAPE_ENDPOINT_URL: 'https://gtm.savingkc.com/data',
        },
      },
      { store, fetch: fetchMock as unknown as typeof fetch },
    )

    expect(result.failed).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.markFailed).toHaveBeenCalledWith(
      row,
      expect.stringContaining('quality score of 1, 2, or 3'),
      expect.objectContaining({
        destinations: expect.arrayContaining([
          expect.objectContaining({ destination: 'stape', status: 'skipped' }),
        ]),
      }),
      expect.any(Date),
    )
  })

  it('keeps stage 3 diagnostic rows out of Google and Stape exports', async () => {
    const row = makeRow({
      event_name: 'lead_stage3_completed',
      event_category: 'form',
      optimization_role: 'secondary',
      conversion_value: 1,
      payload: { form_status: 'stage_3_complete_no_submit', google_ads_quality_score: 1 },
    })
    const plan = buildGoogleAdsUploadPlan(row, googleConfig())

    expect(plan.kind).toBe('skip')
    if (plan.kind !== 'skip') throw new Error('Expected skip upload plan')
    expect(plan.reason).toContain('CRM diagnostic signal')

    const store = {
      listRows: vi.fn(),
      claimRows: vi.fn(async () => [row]),
      markSent: vi.fn(),
      markSkipped: vi.fn(),
      markFailed: vi.fn(),
    }
    const fetchMock = vi.fn()

    const result = await runPpcConversionExport(
      {
        env: {
          PPC_CONVERSION_EXPORT_DESTINATIONS: 'google_ads,stape',
          PPC_STAPE_ENDPOINT_URL: 'https://gtm.savingkc.com/data',
          GOOGLE_ADS_CUSTOMER_ID: '646966429',
          GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
          GOOGLE_ADS_CLIENT_ID: 'client-id',
          GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
          GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
          GOOGLE_ADS_CONVERSION_ACTIONS_JSON: JSON.stringify({
            qualified_lead: 'customers/646966429/conversionActions/333',
          }),
        },
      },
      { store, fetch: fetchMock as unknown as typeof fetch },
    )

    expect(result.skipped).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.markSkipped).toHaveBeenCalledWith(
      row,
      expect.stringContaining('CRM diagnostic signal'),
      expect.objectContaining({
        destinations: expect.arrayContaining([
          expect.objectContaining({ destination: 'google_ads', status: 'skipped' }),
          expect.objectContaining({ destination: 'stape', status: 'skipped' }),
        ]),
      }),
      expect.any(Date),
    )
  })

  it('leaves the queue untouched when no export destination is configured', async () => {
    const store = {
      listRows: vi.fn(),
      claimRows: vi.fn(),
      markSent: vi.fn(),
      markSkipped: vi.fn(),
      markFailed: vi.fn(),
    }

    const result = await runPpcConversionExport({ env: {} }, { store })

    expect(result).toMatchObject({
      ok: false,
      configured: false,
      scanned: 0,
      claimed: 0,
    })
    expect(store.claimRows).not.toHaveBeenCalled()
  })
})
