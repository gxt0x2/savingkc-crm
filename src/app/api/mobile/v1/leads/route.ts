import { NextRequest, NextResponse } from 'next/server'

import {
  MobileAuthError,
  mobileNoStoreHeaders,
  mobileOptionsResponse,
  requireMobileUser,
} from '@/lib/mobile-api/auth'
import { decodeContactDirectoryCursor, readContactDirectoryPage } from '@/lib/server/contact-directory-read-model'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PIPELINE_LISTS = [
  'new',
  'contacted',
  'qualified',
  'appointment_set',
  'offer_made',
  'in_closing',
  'all',
] as const

type PipelineList = (typeof PIPELINE_LISTS)[number]

export function OPTIONS() {
  return mobileOptionsResponse()
}

function pipelineList(value: string | null): PipelineList {
  return PIPELINE_LISTS.includes(value as PipelineList) ? value as PipelineList : 'contacted'
}

type DirectoryPage = Awaited<ReturnType<typeof readContactDirectoryPage>>

function mergeSearchPages(pages: DirectoryPage[], limit: number): DirectoryPage {
  const activePage = pages[0]
  const items = Array.from(new Map(
    pages.flatMap((page) => page.items).map((item) => [item.id, item]),
  ).values())
    .sort((left, right) => {
      const activityDelta = Date.parse(right.last_activity_at) - Date.parse(left.last_activity_at)
      return activityDelta || left.id.localeCompare(right.id)
    })
    .slice(0, limit)

  return {
    ...activePage,
    items,
    totalCount: pages.reduce((total, page) => total + page.totalCount, 0),
    // Global contact search is deliberately bounded instead of pretending one
    // cursor can continue three independently ordered canonical scopes.
    hasMore: false,
    nextCursor: null,
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireMobileUser(req)
    const { searchParams } = new URL(req.url)
    const requestedLimit = Number(searchParams.get('limit') || '25')
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : 25
    const list = pipelineList(searchParams.get('list'))
    const search = searchParams.get('q')?.trim() || ''
    const cursor = decodeContactDirectoryCursor(searchParams.get('cursor')?.trim() || null)
    const directoryQuery = (smartList: string, scope: string, queryLimit = limit) => ({
      smartList,
      scope,
      limit: queryLimit,
      cursor,
      sort: 'recent',
      search,
      owner: '',
      stage: '',
      minimumStage: '',
      source: '',
      tag: '',
      activity: '',
      attention: '',
      outreach: '',
      dataGap: '',
      referenceTime: new Date().toISOString(),
    })
    const page = list === 'all' && search && !cursor
      ? mergeSearchPages(await Promise.all([
        readContactDirectoryPage(directoryQuery('all', 'active', 50)),
        readContactDirectoryPage(directoryQuery('prospects', 'prospects', 50)),
        readContactDirectoryPage(directoryQuery('not_leads', 'not_leads', 50)),
      ]), limit)
      : await readContactDirectoryPage(directoryQuery(list, 'active'))

    const leads = page.items.map((item) => ({
      id: item.id,
      full_name: item.full_name,
      phone: item.phone,
      email: item.email,
      property_address: item.address,
      city: item.city,
      state: null,
      zip: null,
      station: item.station,
      classification: item.classification,
      dead_reason: item.dead_reason,
      assigned_agent: item.owner,
      source: item.source,
      priority: null,
      score: item.score,
      is_favorite: item.is_favorite,
      attention_state: item.attention_state,
      last_message: item.last_communication_description?.trim() || 'No conversation yet',
      last_activity_at: item.last_activity_at,
      primary_next_action: item.primary_next_action_id ? {
        id: item.primary_next_action_id,
        title: item.primary_next_action_title?.trim() || 'Next action',
        due_at: item.primary_next_action_due_at,
        owner: item.primary_next_action_owner ?? item.owner,
        overdue: Boolean(item.primary_next_action_due_at && new Date(item.primary_next_action_due_at) < new Date()),
      } : null,
      motivation_score: null,
      appointment_date: null,
      updated_at: item.updated_at,
      created_at: item.created_at,
    }))

    return NextResponse.json({
      leads,
      counts: Object.fromEntries(PIPELINE_LISTS.map((key) => [key, page.smartListCounts[key] ?? 0])),
      pageInfo: {
        total: page.totalCount,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      },
    }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    if (error instanceof MobileAuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: mobileNoStoreHeaders() },
      )
    }
    console.error('[mobile/leads] canonical pipeline read failed', error)
    return NextResponse.json(
      { error: 'Mobile Pipeline is temporarily unavailable.' },
      { status: 503, headers: mobileNoStoreHeaders() },
    )
  }
}
