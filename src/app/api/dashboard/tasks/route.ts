import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, due_date, priority, status, lead_id')
      .in('status', ['pending', 'overdue'])
      .order('due_date', { ascending: true })
      .limit(5)

    if (error) {
      return NextResponse.json({ tasks: [] })
    }

    return NextResponse.json({ tasks: data || [] })
  } catch {
    return NextResponse.json({ tasks: [] })
  }
}
