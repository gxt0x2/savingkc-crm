import { NextRequest, NextResponse } from 'next/server'
import { requireMobileUser, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { oauthReviewForeignLeadResponse } from '@/lib/auth/oauth-review-sandbox-session'
import { operatingDepartmentForStage } from '@/lib/operating-model/department-responsibility'
import { applyCrmEntityAuthority, safeReadLeadEntityContext } from '@/lib/server/crm-entity-foundation'
import { listWorkItems } from '@/lib/server/work-items'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { mobileRecordingUrl } from '@/lib/mobile-api/mojo-recording'
import { twilioRecordingSid } from '@/lib/mobile-api/twilio-recording'
import { mobileInboundRoute } from '@/lib/mobile-api/inbound-route'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

const LEAD_SELECT = [
  'id',
  'full_name',
  'phone',
  'email',
  'property_address',
  'city',
  'state',
  'zip',
  'county',
  'station',
  'classification',
  'dead_reason',
  'priority',
  'motivation_score',
  'is_favorite',
  'beds',
  'baths_full',
  'baths_half',
  'sqft',
  'year_built',
  'arv',
  'asking_price',
  'property_condition',
  'seller_situation',
  'appointment_date',
  'assigned_agent',
  'updated_at',
  'created_at',
].join(', ')

type MobileLeadRow = Record<string, unknown> & {
  station: string | null
  assigned_agent: string | null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireMobileUser(req)
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400, headers: mobileNoStoreHeaders() })
    }
    const hiddenLead = await oauthReviewForeignLeadResponse(id, req)
    if (hiddenLead) return hiddenLead
    await requireAuthorizedMobileLead(req, id)

    const db = supabaseAdmin()
    const [leadRes, activityRes, workItemsState, handoffsRes, entityContext] = await Promise.all([
      db.from('leads').select(LEAD_SELECT).eq('id', id).maybeSingle(),
      db
        .from('lead_activities')
        .select('id, activity_type, description, agent, metadata, created_at')
        .eq('lead_id', id)
        .order('created_at', { ascending: false })
        .limit(10),
      listWorkItems({ leadId: id, statuses: ['pending', 'blocked'], limit: 20 })
        .then((data) => ({ data, error: null }))
        .catch((error: unknown) => ({ data: [], error })),
      db
        .from('crm_department_handoffs')
        .select('id,from_department,to_department,status,assigned_to,reason,evidence_type,created_at')
        .eq('lead_id', id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10),
      safeReadLeadEntityContext(id),
    ])

    if (leadRes.error) {
      return NextResponse.json(
        { error: leadRes.error.message },
        { status: 500, headers: mobileNoStoreHeaders() },
      )
    }

    if (!leadRes.data) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404, headers: mobileNoStoreHeaders() })
    }

    if (activityRes.error) {
      return NextResponse.json(
        { error: activityRes.error.message },
        { status: 500, headers: mobileNoStoreHeaders() },
      )
    }

    const compatibilityLead = leadRes.data as unknown as MobileLeadRow
    const lead = applyCrmEntityAuthority(compatibilityLead, entityContext)
    const canonicalProperty = entityContext.available && entityContext.linked && !entityContext.degraded
      ? entityContext.property : null
    if (workItemsState.error) console.error('[mobile/leads/:id] work-item read failed', workItemsState.error)
    if (handoffsRes.error) console.error('[mobile/leads/:id] handoff read failed', handoffsRes.error.message)
    const primaryNextAction = workItemsState.data.find((item) => item.primaryNextAction)
      ?? workItemsState.data[0]
      ?? null
    const mobileActivities = (activityRes.data ?? []).map((activity) => {
      if (!['call', 'missed_call', 'voicemail'].includes(activity.activity_type)) return activity
      const metadata = activity.metadata && typeof activity.metadata === 'object' && !Array.isArray(activity.metadata)
        ? activity.metadata as Record<string, unknown> : {}
      const recordingUrl = mobileRecordingUrl(activity.id, metadata, process.env.TWILIO_ACCOUNT_SID, twilioRecordingSid)
      const safeMetadata = { ...metadata }
      for (const key of ['recordingUrl', 'recording_url', 'RecordingUrl', 'recording']) delete safeMetadata[key]
      const inboundRoute = mobileInboundRoute(safeMetadata, activity.description)
      return { ...activity, metadata: { ...safeMetadata, ...(recordingUrl ? { recordingUrl } : {}), ...(inboundRoute ? { inboundRoute } : {}) } }
    })

    return NextResponse.json(
      {
        lead,
        entityContext,
        propertyFacts: {
          lead: {
            property_address: compatibilityLead.property_address,
            city: compatibilityLead.city,
            state: compatibilityLead.state,
            zip: compatibilityLead.zip,
            beds: compatibilityLead.beds,
            baths_full: compatibilityLead.baths_full,
            baths_half: compatibilityLead.baths_half,
            sqft: compatibilityLead.sqft,
            year_built: compatibilityLead.year_built,
            arv: compatibilityLead.arv,
            asking_price: compatibilityLead.asking_price,
            property_condition: compatibilityLead.property_condition,
            seller_situation: compatibilityLead.seller_situation,
          },
          property: canonicalProperty ? {
            id: canonicalProperty.id,
            updated_at: canonicalProperty.updatedAt,
            address: canonicalProperty.address,
            city: canonicalProperty.city,
            state: canonicalProperty.state,
            zip: canonicalProperty.zip,
            bedrooms: canonicalProperty.bedrooms,
            bathrooms: canonicalProperty.bathrooms,
            sqft: canonicalProperty.sqft,
            year_built: canonicalProperty.yearBuilt,
            occupancy_status: canonicalProperty.occupancyStatus,
            zestimate: canonicalProperty.zestimate,
            tax_assessment: canonicalProperty.taxAssessment,
            last_sale_price: canonicalProperty.lastSalePrice,
            redfin_estimate: canonicalProperty.redfinEstimate,
          } : null,
        },
        activities: mobileActivities,
        operations: {
          department: operatingDepartmentForStage(lead.station),
          owner: lead.assigned_agent ?? null,
          primaryNextAction,
          tasksAvailable: !workItemsState.error,
          pendingHandoffs: handoffsRes.error ? [] : handoffsRes.data ?? [],
          handoffsAvailable: !handoffsRes.error,
        },
      },
      { headers: mobileNoStoreHeaders() },
    )
  } catch (error) {
    const known = error instanceof MobileAuthError || error instanceof MobileLeadAccessError
    const status = known ? error.status : 500
    const message = known ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
