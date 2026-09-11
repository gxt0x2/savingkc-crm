import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import expectedRuntime from '@/config/mojo-runtime-manifest.json'

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const key = req.nextUrl.searchParams.get('key')
  if (!key) {
    return NextResponse.json({ error: 'key required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('system_config')
    .select('value, updated_at')
    .eq('key', key)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    key,
    value: data?.value ?? null,
    updated_at: data?.updated_at ?? null,
  })
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const body = await req.json()
  const { key, value } = body
  if (typeof key === 'string' && /^(?:last_)?mojo_/.test(key)
    && req.headers.get('x-mojo-runtime-digest') !== expectedRuntime.contentDigest) {
    console.warn(JSON.stringify({ event: 'mojo_config_writer_rejected', key }))
    return NextResponse.json({ error: 'Mojo importer update required' }, { status: 409 })
  }

  if (!key) {
    return NextResponse.json({ error: 'key required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('system_config')
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, key, value })
}
