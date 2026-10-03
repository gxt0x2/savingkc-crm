import { NextRequest, NextResponse } from 'next/server'

import { assistantActorCanReadCompanyWide } from '@/lib/assistant/auth'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileCommandAccessError, requireMobileCommandActor } from '@/lib/mobile-api/mobile-command-access'
import { mobileActorCanReadAssignedLead } from '@/lib/mobile-api/authorized-lead'
import { mapMobileAppointment } from '@/lib/server/mobile-appointments'
import { listWorkItems, WorkItemError } from '@/lib/server/work-items'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(req: NextRequest) {
  try {
    const { scopedActor } = await requireMobileCommandActor(req)
    const companyWide = assistantActorCanReadCompanyWide(scopedActor)
    const workItems = await listWorkItems({
      statuses: ['pending', 'blocked'],
      limit: 300,
    })
    const scheduledItems = workItems.filter((item) => Boolean(item.dueAt))
    const { data: appointmentRows, error: appointmentError } = await supabaseAdmin()
      .from('appointments')
      .select('id,lead_id,type,status,scheduled_at,ends_at,title,location,address,time_zone,assigned_to,notes,sequence_enabled,version,source,created_at,updated_at,provider_event_id,provider_sync_status,provider_synced_at,provider_sync_error,mobile_appointment_calendar_sync(owner_email)')
      .neq('status', 'cancelled')
      .order('scheduled_at', { ascending: false }).limit(300)
    if (appointmentError) throw new Error('calendar appointment read failed')
    const leadIds = [...new Set([
      ...scheduledItems.flatMap((item) => item.leadId ? [item.leadId] : []),
      ...(appointmentRows ?? []).flatMap((row) => row.lead_id ? [row.lead_id as string] : []),
    ])]
    const contacts = new Map<string, { full_name: string | null; property_address: string | null; assigned_agent: string | null }>()

    if (leadIds.length > 0) {
      const { data, error } = await supabaseAdmin()
        .from('leads')
        .select('id,full_name,property_address,assigned_agent')
        .in('id', leadIds)
      if (error) throw new Error('calendar contact read failed')
      for (const contact of data ?? []) {
        contacts.set(contact.id, contact)
      }
    }

    const canReadLead = (leadId: string | null) => Boolean(leadId && contacts.has(leadId)
      && (companyWide || mobileActorCanReadAssignedLead(scopedActor, contacts.get(leadId)?.assigned_agent)))
    return NextResponse.json({
      items: scheduledItems.filter((item) => item.leadId
        ? canReadLead(item.leadId)
        : companyWide || mobileActorCanReadAssignedLead(scopedActor, item.assignedTo)).map((item) => {
        const contact = item.leadId ? contacts.get(item.leadId) : null
        return {
          id: item.key,
          recordKind: 'work_item',
          workItemKey: item.key,
          workItemVersion: item.version,
          sourceKind: item.sourceKind,
          sourceId: item.sourceId,
          type: item.kind,
          title: item.title,
          description: item.description,
          contactId: item.leadId,
          contactName: contact?.full_name ?? null,
          propertyAddress: contact?.property_address ?? null,
          dueAt: item.dueAt,
          assignedTo: item.assignedTo,
          role: item.role,
          department: item.department,
          priority: item.priority,
          status: item.status,
          updatedAt: item.updatedAt,
        }
      }),
      appointments: (appointmentRows ?? []).filter((row) => canReadLead(row.lead_id)).map((row) => mapMobileAppointment(row)),
      serverNow: new Date().toISOString(),
    }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    if (error instanceof MobileAuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: mobileNoStoreHeaders() },
      )
    }
    if (error instanceof MobileCommandAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: mobileNoStoreHeaders() })
    }
    const message = error instanceof WorkItemError && error.code === 'unavailable'
      ? 'Calendar is temporarily unavailable.'
      : 'Mobile Calendar is temporarily unavailable.'
    console.error('[mobile/calendar] read failed', error)
    return NextResponse.json({ error: message }, { status: 503, headers: mobileNoStoreHeaders() })
  }
}
