import { expiredRowStamp } from '@/lib/market-check/expired-gate'
import { propertyKey, type MarketPlan } from '@/lib/market-check/plan'

export interface MarketWriteResult {
  checks: number
  tags: number
  intakes: number
  coveredZips: string[]
}

interface QueryResult<T> {
  data: T | null
  error: { message?: string } | null
}

export interface MarketWriteClient {
  from(table: string): {
    insert(rows: unknown): {
      select(columns: string): PromiseLike<QueryResult<unknown>>
    } & PromiseLike<QueryResult<unknown>>
    select(columns: string): {
      eq(column: string, value: string): {
        is(column: string, value: null): {
          is(column2: string, value2: null): {
            eq(column3: string, value3: string): {
              maybeSingle(): PromiseLike<QueryResult<{ id?: string } | null>>
            }
          }
        }
      }
    }
  }
}

function rowsOf(data: unknown): Array<Record<string, unknown>> {
  return Array.isArray(data) ? data.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object') : []
}

async function insertReturning(
  db: MarketWriteClient,
  table: string,
  payload: unknown[],
  columns: string,
): Promise<Array<Record<string, unknown>>> {
  if (!payload.length) return []
  const result = await db.from(table).insert(payload).select(columns)
  if (result.error) throw new Error(result.error.message || `Could not write ${table}.`)
  return rowsOf(result.data)
}

export async function writeMarketPlan(
  db: MarketWriteClient,
  plan: MarketPlan,
  actor: string,
  file: { sha256: string; bytes: number; name: string; pullDate: string },
): Promise<MarketWriteResult> {
  const inserted = await insertReturning(db, 'property_market_checks', plan.checks.map((check) => ({
    parcel_id: check.parcelId,
    addr_norm: check.addrNorm || null,
    zip5: check.zip5 || null,
    source: check.source,
    list_day: check.listDay,
    export_file_sha256: check.exportFileSha256,
    mls_number: check.mlsNumber,
    list_status_raw: check.listStatusRaw,
    listing_status: check.listingStatus,
    close_date: check.closeDate,
    list_price: check.listPrice,
    owner_on_roll: check.ownerOnRoll,
    owner_changed: check.ownerChanged,
  })), 'id, parcel_id, addr_norm, zip5, listing_status')

  const checkId = new Map<string, string>()
  for (const row of inserted) {
    const id = typeof row.id === 'string' ? row.id : ''
    const key = propertyKey(
      typeof row.parcel_id === 'string' ? row.parcel_id : null,
      typeof row.addr_norm === 'string' ? row.addr_norm : '',
      typeof row.zip5 === 'string' ? row.zip5 : '',
    )
    if (id && key && !checkId.has(key)) checkId.set(key, id)
  }

  let sourceListId: string | null = null
  const intakeIds = new Map<string, string>()
  if (plan.intakes.length) {
    const found = await db.from('source_lists').select('id')
      .eq('list_type', 'mls_expired')
      .is('county', null)
      .is('state', null)
      .eq('source_file_sha256', file.sha256)
      .maybeSingle()
    if (found.error) throw new Error(found.error.message || 'Could not read the MLS source list.')
    sourceListId = found.data?.id ?? null
    if (!sourceListId) {
      const created = await insertReturning(db, 'source_lists', [{
        list_type: 'mls_expired',
        pull_date: file.pullDate,
        source_file_name: file.name.slice(0, 200),
        source_file_sha256: file.sha256,
        source_file_bytes: file.bytes,
        imported_by: actor.slice(0, 320),
      }], 'id')
      sourceListId = typeof created[0]?.id === 'string' ? created[0].id : null
    }
    if (!sourceListId) throw new Error('Could not open the MLS expired source list.')
    const createdRows = await insertReturning(db, 'source_list_rows', plan.intakes.map((intake) => ({
      source_list_id: sourceListId,
      list_type: 'mls_expired',
      county: intake.county,
      state: intake.state,
      match_key: intake.matchKey,
      parcel_id: intake.parcelId,
      address: intake.address,
      phones: [],
      raw: {
        mls_number: intake.mlsNumber,
        zip5: intake.zip5,
        addr_norm: intake.addrNorm,
        ...expiredRowStamp(intake.state),
      },
      status: 'new_needs_skip',
      list_day: intake.listDay,
      requires_licensee_disclosure: true,
      strategy: 'wholesale',
      updated_by: actor.slice(0, 320),
    })), 'id, match_key')
    plan.intakes.forEach((intake, index) => {
      const id = createdRows[index]?.id
      if (typeof id === 'string') intakeIds.set(intake.propertyKey, id)
    })
  }

  const tagRows = [
    ...plan.tags.map((tag) => ({
      source_list_row_id: tag.poolRowId,
      mls_tag: tag.mlsTag,
      strategy: tag.strategy,
      list_day: tag.listDay,
      source_check_id: checkId.get(tag.propertyKey) ?? null,
    })),
    ...plan.intakes.map((intake) => ({
      source_list_row_id: intakeIds.get(intake.propertyKey) ?? null,
      mls_tag: 'expired_listing',
      strategy: 'wholesale',
      list_day: intake.listDay,
      source_check_id: checkId.get(intake.propertyKey) ?? null,
    })),
  ].filter((tag) => tag.source_list_row_id && tag.source_check_id)

  await insertReturning(db, 'source_list_row_mls_tags', tagRows, 'id')
  await insertReturning(db, 'mls_export_runs', [{
    export_file_sha256: file.sha256,
    chicago_day: file.pullDate,
    status: 'loaded',
    covered_zips: plan.coveredZips,
    row_count: plan.checks.length,
    finished_at: new Date().toISOString(),
  }], 'id')

  return {
    checks: inserted.length,
    tags: tagRows.length,
    intakes: plan.intakes.length,
    coveredZips: plan.coveredZips,
  }
}
