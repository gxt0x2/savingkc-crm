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

export async function GET(req: NextRequest) {
  try {
    await requireMobileUser(req)
    const { searchParams } = new URL(req.url)
    const requestedLimit = Number(searchParams.get('limit') || '25')
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : 25
    const list = pipelineList(searchParams.get('list'))
    const page = await readContactDirectoryPage({
      smartList: list,
      scope: 'active',
      limit,
      cursor: decodeContactDirectoryCursor(searchParams.get('cursor')?.trim() || null),
      sort: 'recent',
      search: searchParams.get('q')?.trim() || '',
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
