import { NextRequest, NextResponse } from 'next/server'

import {
  MobileAuthError,
  mobileNoStoreHeaders,
  mobileOptionsResponse,
} from '@/lib/mobile-api/auth'
import { assistantActorCanReadCompanyWide } from '@/lib/assistant/auth'
import { MobileLeadAccessError, mobileActorCanReadAssignedLead, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { MobileCommandAccessError, requireMobileCommandActor } from '@/lib/mobile-api/mobile-command-access'
import { resolveOauthReviewSandboxLeadId } from '@/lib/auth/oauth-review-sandbox-session'
import { decodeContactDirectoryCursor, readContactDirectoryPage } from '@/lib/server/contact-directory-read-model'
import { readOauthReviewContactDirectoryPage } from '@/lib/server/oauth-review-contact-directory'

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
    const { scopedActor } = await requireMobileCommandActor(req)
    const companyWide = assistantActorCanReadCompanyWide(scopedActor)
    const owner = companyWide ? '' : scopedActor.assignmentAliases[0]
    if (!companyWide && (!owner || owner === '__unassigned')) return NextResponse.json({ error: 'CRM assignment unavailable' }, { status: 403, headers: mobileNoStoreHeaders() })
    const { searchParams } = new URL(req.url)
    const requestedLimit = Number(searchParams.get('limit') || '25')
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : 25
    const list = pipelineList(searchParams.get('list'))
    const rawCursor = searchParams.get('cursor')?.trim() || null
    const cursor = rawCursor && rawCursor.length <= 2048 ? decodeContactDirectoryCursor(rawCursor) : null
    if (rawCursor && !cursor) {
      return NextResponse.json({ error: 'Invalid Pipeline page cursor.' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const directoryQuery = {
      smartList: list,
      scope: 'active',
      limit,
      cursor,
      sort: 'recent',
      search: searchParams.get('q')?.trim() || '',
      owner,
      stage: '',
      minimumStage: '',
      source: '',
      tag: '',
      activity: '',
      attention: '',
      outreach: '',
      dataGap: '',
      referenceTime: new Date().toISOString(),
    }
    const sandboxLeadId = await resolveOauthReviewSandboxLeadId(req)
    if (sandboxLeadId) await requireAuthorizedMobileLead(req, sandboxLeadId)
    const page = sandboxLeadId
      ? await readOauthReviewContactDirectoryPage(directoryQuery, sandboxLeadId)
      : await readContactDirectoryPage(directoryQuery)
    // v4's page/total are owner-filtered, but smartListCounts are global. Never
    // return those counts to a scoped operator. Each replacement count is read
    // with the same owner predicate before page limiting.
    const scopedCounts = companyWide || sandboxLeadId ? page.smartListCounts : Object.fromEntries(await Promise.all(
      PIPELINE_LISTS.map(async (key) => {
        const countPage = key === list && !directoryQuery.search && !directoryQuery.cursor
          ? page
          : await readContactDirectoryPage({ ...directoryQuery, smartList: key, limit: 1, cursor: null, search: '' })
        return [key, countPage.totalCount] as const
      }),
    ))

    const leads = page.items.filter((item) => mobileActorCanReadAssignedLead(scopedActor, item.owner)).map((item) => ({
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
      counts: Object.fromEntries(PIPELINE_LISTS.map((key) => [key, scopedCounts[key] ?? 0])),
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
    if (error instanceof MobileCommandAccessError) return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
    if (error instanceof MobileLeadAccessError) return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
    console.error('[mobile/leads] canonical pipeline read failed', error)
    return NextResponse.json(
      { error: 'Mobile Pipeline is temporarily unavailable.' },
      { status: 503, headers: mobileNoStoreHeaders() },
    )
  }
}
