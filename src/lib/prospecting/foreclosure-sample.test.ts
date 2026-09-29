import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FORECLOSURE_SAMPLE_EXTERNAL_ID,
  FORECLOSURE_SAMPLE_ID,
  foreclosureSampleById,
  foreclosureSampleContactEnabled,
  foreclosureSampleDatabaseRow,
  foreclosureSampleProspect,
  mergeForeclosureSample,
} from '@/lib/prospecting/foreclosure-sample'

describe('foreclosure sample contact', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is one demo homeowner with a mobile and a landline', () => {
    const sample = foreclosureSampleProspect()
    expect(sample.id).toBe(FORECLOSURE_SAMPLE_ID)
    expect(sample.demo).toBe(true)
    expect(sample.ownerName).toBe('Sample Homeowner')
    expect(sample.zip).toBe('64108')
    expect(sample.status).toBe('new')
    expect(sample.dialReady).toBe(false)
    expect(sample.phones).toEqual(['+18165550101', '+18165550198'])
    expect(sample.skipPhones.map((row) => ({ contactName: row.contactName, relationship: row.relationship, line: row.line }))).toEqual([
      { contactName: 'Sample Homeowner', relationship: 'subject', line: 'mobile' },
      { contactName: 'Sample Homeowner', relationship: 'subject', line: 'landline' },
    ])
    expect(foreclosureSampleDatabaseRow().external_row_id).toBe(FORECLOSURE_SAMPLE_EXTERNAL_ID)
    expect(foreclosureSampleDatabaseRow().skip_phones).toHaveLength(2)
  })

  it('shows on preview and stays out of production', () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('FORECLOSURE_SAMPLE_CONTACT', '1')
    expect(foreclosureSampleContactEnabled()).toBe(false)
    expect(foreclosureSampleById(FORECLOSURE_SAMPLE_ID)).toBeNull()
    expect(mergeForeclosureSample([{ id: 'row', externalRowId: null }], { status: 'new' }, '2026-09-29')).toHaveLength(1)

    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('FORECLOSURE_SAMPLE_CONTACT', '')
    expect(foreclosureSampleContactEnabled()).toBe(true)
    expect(foreclosureSampleById(FORECLOSURE_SAMPLE_ID)?.ownerName).toBe('Sample Homeowner')
    expect(foreclosureSampleById('other')).toBeNull()
    const merged = mergeForeclosureSample([], { status: 'new' }, '2026-09-29')
    expect(merged.map((row) => row.id)).toEqual([FORECLOSURE_SAMPLE_ID])
    expect(mergeForeclosureSample([], { status: 'callable' }, '2026-09-29')).toHaveLength(0)
    expect(mergeForeclosureSample([], { county: 'johnson' }, '2026-09-29')).toHaveLength(0)
    expect(mergeForeclosureSample([], { dialReady: true }, '2026-09-29')).toHaveLength(0)
    expect(mergeForeclosureSample(
      [{ id: 'db-row', externalRowId: FORECLOSURE_SAMPLE_EXTERNAL_ID }],
      { status: 'new' },
      '2026-09-29',
    )).toHaveLength(1)
  })
})
