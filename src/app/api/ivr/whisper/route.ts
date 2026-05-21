import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'




function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    const area = digits.slice(1, 4)
    const prefix = digits.slice(4, 7)
    const line = digits.slice(7)
    return `${area}, ${prefix}, ${line}`
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}, ${digits.slice(3, 6)}, ${digits.slice(6)}`
  }
  return digits.split('').join(', ')
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const from = url.searchParams.get('from') || ''
    const leadId = url.searchParams.get('leadId') || ''
    const type = url.searchParams.get('type') || 'call' // seller | non_seller | call

    let name = ''
    let address = ''

  // Try to get lead info — by ID first, then by phone (only for direct calls)
  if (type === 'direct') {
    if (leadId) {
      const { data } = await supabase
        .from('leads')
        .select('full_name, property_address')
        .eq('id', leadId)
        .single()
      if (data) {
        if (data.full_name && !data.full_name.includes('Inbound') && !data.full_name.includes('Caller')) name = data.full_name
        if (data.property_address) address = data.property_address
      }
    } else if (from) {
      const { data } = await supabase
        .from('leads')
        .select('full_name, property_address')
        .eq('phone', from)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (data) {
        if (data.full_name && !data.full_name.includes('Inbound') && !data.full_name.includes('Caller')) name = data.full_name
        if (data.property_address) address = data.property_address
      }
    }
  } else if (leadId || from) {
    // For IVR calls, keep the full lookup
    if (leadId) {
      const { data } = await supabase
        .from('leads')
        .select('full_name, property_address')
        .eq('id', leadId)
        .single()
      if (data) {
        if (data.full_name && data.full_name !== 'Inbound Seller') name = data.full_name
        if (data.property_address) address = data.property_address
      }
    } else if (from) {
      const { data } = await supabase
        .from('leads')
        .select('full_name, property_address')
        .eq('phone', from)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (data) {
        if (data.full_name && data.full_name !== 'Inbound Seller') name = data.full_name
        if (data.property_address) address = data.property_address
      }
    }
  }

  // Build brief whisper
  let whisper = ''

  if (type === 'direct') {
    if (name) {
      whisper = `Call from ${name}`
    } else {
      whisper = 'Call from new lead'
    }
  } else if (type === 'google_ads') {
    whisper = 'Google Ads'
  } else {
    const parts: string[] = []
    if (type === 'seller') {
      parts.push('Inbound seller')
    } else if (type === 'non_seller') {
      parts.push('Inbound call')
    } else {
      parts.push('Incoming call')
    }
    if (name) parts.push(name)
    if (address) parts.push(address)
    if (from) parts.push(formatPhone(from))
    whisper = parts.join('. ') + '.'
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="Polly.Joanna">${whisper}</Say>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  } catch (error) {
    console.error('[IVR/whisper] Error:', error)
    // Silent fallback - just connect without whisper
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
</Response>`
    return new NextResponse(fallbackTwiml, { headers: { 'Content-Type': 'text/xml' } })
  }
}
