import { NextRequest, NextResponse } from 'next/server'

import {
  MobileAuthError,
  mobileNoStoreHeaders,
  mobileOptionsResponse,
  requireMobileUser,
} from '@/lib/mobile-api/auth'
import { listMobileAppointments } from '@/lib/server/mobile-appointments'
import { listWorkItems, WorkItemError } from '@/lib/server/work-items'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(req: NextRequest) {
  try {
    await requireMobileUser(req)
    const [workItems, appointments] = await Promise.all([
      listWorkItems({ statuses: ['pending', 'blocked'], limit: 300 }),
      listMobileAppointments(300),
    ])
    const scheduledItems = workItems.filter((item) => Boolean(item.dueAt))
    const leadIds = [...new Set([
      ...scheduledItems.flatMap((item) => item.leadId ? [item.leadId] : []),
      ...appointments.map((appointment) => appointment.leadId),
    ])]
    const contacts = new Map<string, { full_name: string | null; property_address: string | null }>()

    if (leadIds.length > 0) {
      const { data, error } = await supabaseAdmin()
        .from('leads')
        .select('id,full_name,property_address')
        .in('id', leadIds)
      if (error) throw new Error('calendar contact read failed')
      for (const contact of data ?? []) {
        contacts.set(contact.id, contact)
      }
    }

    return NextResponse.json({
      items: [
        ...appointments.map((appointment) => {
          const contact = contacts.get(appointment.leadId)
          return {
            id: appointment.id,
            recordKind: 'appointment',
            appointmentId: appointment.id,
            appointmentVersion: appointment.version,
            type: appointment.type,
            status: appointment.status,
            title: appointment.title,
            description: appointment.notes,
            contactId: appointment.leadId,
            contactName: contact?.full_name ?? null,
            propertyAddress: contact?.property_address ?? null,
            startsAt: appointment.scheduledAt,
            endsAt: appointment.endsAt,
            location: appointment.location,
            timeZone: appointment.timeZone,
            assignedTo: appointment.assignedTo,
            sendReminder: appointment.sendReminder,
            sync: appointment.sync,
            updatedAt: appointment.updatedAt,
          }
        }),
        ...scheduledItems.map((item) => {
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
      ],
      serverNow: new Date().toISOString(),
    }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    if (error instanceof MobileAuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: mobileNoStoreHeaders() },
      )
    }
    const message = error instanceof WorkItemError && error.code === 'unavailable'
      ? 'Calendar is temporarily unavailable.'
      : 'Mobile Calendar is temporarily unavailable.'
    console.error('[mobile/calendar] read failed', error)
    return NextResponse.json({ error: message }, { status: 503, headers: mobileNoStoreHeaders() })
  }
}
