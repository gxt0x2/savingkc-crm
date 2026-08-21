import { NextResponse } from 'next/server'
import { listWorkItems } from '@/lib/server/work-items'




export async function GET() {
  try {
    const items = await listWorkItems({ statuses: ['pending', 'blocked'], limit: 5 })
    return NextResponse.json({
      tasks: items.map((item) => ({
        id: item.key,
        title: item.title,
        due_date: item.dueAt,
        priority: item.priority,
        status: item.status,
        lead_id: item.leadId,
      })),
    })
  } catch {
    return NextResponse.json({ tasks: [] })
  }
}
