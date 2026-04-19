import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'




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
