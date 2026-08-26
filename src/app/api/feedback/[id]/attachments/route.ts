import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const { data, error } = await supabaseAdmin()
      .from('feedback_attachments')
      .select('id, feedback_id, filename, mime_type, byte_size, kind, created_at')
      .eq('feedback_id', id)
      .order('created_at', { ascending: true })

    if (error) {
      const missingTable = error.code === 'PGRST205' || /feedback_attachments|schema cache|could not find/i.test(error.message ?? '')
      return NextResponse.json(
        { error: missingTable ? 'Andon attachment storage is not initialized.' : 'Attachments could not be loaded.' },
        { status: missingTable ? 503 : 500 },
      )
    }
    return NextResponse.json({ attachments: data ?? [] })
  } catch (error) {
    console.error('[Andon attachments] list failed:', error)
    return NextResponse.json({ error: 'Attachments could not be loaded.' }, { status: 500 })
  }
}
