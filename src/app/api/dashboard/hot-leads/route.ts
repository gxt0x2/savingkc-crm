import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('id, full_name, phone, source, created_at, station')
      .eq('priority', 'hot')
      .order('created_at', { ascending: false })
      .limit(5)

    if (error) {
      return NextResponse.json({ leads: [] })
    }

    return NextResponse.json({ leads: data || [] })
  } catch {
    return NextResponse.json({ leads: [] })
  }
}
