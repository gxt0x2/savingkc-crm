export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

function cleanPhone(phone: unknown) {
  return typeof phone === 'string' && phone.trim() ? phone : null
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim().toLowerCase() || ''
    const db = supabaseAdmin()

    const [sellerRes, buyerRes, vendorRes] = await Promise.all([
      db
        .from('leads')
        .select('id, full_name, phone, email, property_address, city, state, priority, station, updated_at')
        .order('updated_at', { ascending: false })
        .limit(120),
      db
        .from('buyers')
        .select('id, name, company, phone, email, updated_at, created_at')
        .order('updated_at', { ascending: false })
        .limit(120),
      db
        .from('vendors')
        .select('id, name, company_name, category, phone, email, status, is_preferred, updated_at, created_at')
        .order('is_preferred', { ascending: false })
        .order('name', { ascending: true })
        .limit(120),
    ])

    const sellers = (sellerRes.data ?? []).map((row) => ({
      id: row.id,
      type: 'seller',
      name: row.full_name || 'Unknown seller',
      company: null,
      phone: cleanPhone(row.phone),
      email: row.email ?? null,
      context: [row.property_address, row.city, row.state].filter(Boolean).join(', '),
      status: row.station ?? row.priority ?? null,
      href: `/leads/${row.id}`,
      updated_at: row.updated_at,
    }))

    const buyers = (buyerRes.data ?? []).map((row) => ({
      id: row.id,
      type: 'buyer',
      name: row.name || row.company || 'Unknown buyer',
      company: row.company ?? null,
      phone: cleanPhone(row.phone),
      email: row.email ?? null,
      context: row.company ?? 'Buyer',
      status: 'active',
      href: '/dispo/contacts?tab=buyers',
      updated_at: row.updated_at ?? row.created_at,
    }))

    const vendors = (vendorRes.data ?? []).map((row) => ({
      id: row.id,
      type: 'vendor',
      name: row.name || row.company_name || 'Unknown vendor',
      company: row.company_name ?? null,
      phone: cleanPhone(row.phone),
      email: row.email ?? null,
      context: row.category ?? 'Vendor',
      status: row.is_preferred ? 'preferred' : row.status ?? 'active',
      href: '/dispo/contacts?tab=vendors',
      updated_at: row.updated_at ?? row.created_at,
    }))

    let contacts = [...sellers, ...buyers, ...vendors]
    if (q) {
      contacts = contacts.filter((contact) =>
        [contact.name, contact.company, contact.phone, contact.email, contact.context, contact.status]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      )
    }

    return NextResponse.json({
      contacts,
      totals: {
        sellers: sellers.length,
        buyers: buyers.length,
        vendors: vendors.length,
      },
    })
  } catch (err) {
    console.error('[dispo/contacts GET] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
