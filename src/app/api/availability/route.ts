import { NextRequest, NextResponse } from 'next/server'
import { centralSlotDateTime } from '@/lib/server/appointment-time'
import { supabase } from '@/lib/supabase-lazy'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

// Business hours in CT (America/Chicago)
// Mon-Fri: 9:00-18:00, Sat: 10:00-14:00, Sun: closed
function getBusinessHours(dayOfWeek: number): { start: number; end: number } | null {
  if (dayOfWeek === 0) return null // Sunday
  if (dayOfWeek === 6) return { start: 10, end: 14 } // Saturday
  return { start: 9, end: 18 } // Mon-Fri
}

function formatTime12h(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM'
  const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour
  const m = minute.toString().padStart(2, '0')
  return `${h}:${m} ${period}`
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const dateStr = searchParams.get('date')

    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD.' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Parse date in CT timezone
    const dateInCT = new Date(dateStr + 'T12:00:00-05:00') // Use noon to avoid DST issues
    const dayOfWeek = dateInCT.getDay()
    const hours = getBusinessHours(dayOfWeek)

    if (!hours) {
      return NextResponse.json(
        { slots: [], message: 'Closed on Sundays' },
        { status: 200, headers: corsHeaders }
      )
    }

    // Check if date is in the past
    const now = new Date()
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
    const currentHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }))
    const currentMinute = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Chicago', minute: 'numeric' }))
    const isToday = dateStr === todayStr

    if (dateStr < todayStr) {
      return NextResponse.json(
        { slots: [], message: 'Date is in the past' },
        { status: 200, headers: corsHeaders }
      )
    }

    // Generate 30-minute slots
    const allSlots: { time: string; datetime: string; slot_time: string }[] = []
    for (let h = hours.start; h < hours.end; h++) {
      for (const m of [0, 30]) {
        // Skip slots in the past if today (add 1 hour buffer)
        if (isToday && (h < currentHour + 1 || (h === currentHour + 1 && m <= currentMinute))) {
          continue
        }

        const time = formatTime12h(h, m)
        const slotTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`
        
        const datetime = centralSlotDateTime(dateStr, slotTime)

        allSlots.push({ time, datetime, slot_time: slotTime })
      }
    }

    // Fetch already-booked slots for this date
    const { data: bookedSlots, error } = await supabase
      .from('bookings')
      .select('slot_time')
      .eq('slot_date', dateStr)
      .eq('status', 'confirmed')

    if (error) {
      console.error('Supabase query error:', error)
      return NextResponse.json(
        { error: 'Failed to check availability' },
        { status: 500, headers: corsHeaders }
      )
    }

    const bookedTimes = new Set((bookedSlots || []).map(b => b.slot_time))

    // Filter out booked slots
    const availableSlots = allSlots
      .filter(slot => !bookedTimes.has(slot.slot_time))
      .map(({ time, datetime }) => ({ time, datetime }))

    return NextResponse.json(
      { slots: availableSlots },
      { status: 200, headers: corsHeaders }
    )
  } catch (err) {
    console.error('Availability error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
