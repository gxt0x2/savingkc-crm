import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

// In-memory cache (5 min TTL)
let cache: { key: string; data: any; ts: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') || 'morning'
  const agent = req.nextUrl.searchParams.get('agent') || 'Rep'

  const cacheKey = `${mode}-${agent}-${new Date().toDateString()}`
  if (cache && cache.key === cacheKey && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data)
  }

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  try {
    // Fetch today's activity
    const { data: activities } = await supabase
      .from('lead_activities')
      .select('type, activity_type, created_at, metadata')
      .gte('created_at', todayStart.toISOString())

    const calls = (activities || []).filter(a => a.type === 'call' || a.type === 'outbound_call' || a.activity_type === 'call').length
    const smsSent = (activities || []).filter(a => a.type === 'sms_sent' || a.type === 'sms_outbound').length
    const smsReceived = (activities || []).filter(a => a.type === 'sms_received' || a.type === 'sms_inbound').length

    // Fetch pending tasks
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, status, due_date')
      .in('status', ['pending', 'overdue'])
      .lte('due_date', new Date().toISOString())

    const overdueTasks = (tasks || []).filter(t => t.status === 'overdue' || new Date(t.due_date) < todayStart).length
    const todayTasks = (tasks || []).length

    // Fetch hot leads with no recent contact
    const { data: hotLeads } = await supabase
      .from('leads')
      .select('id, full_name, station')
      .eq('priority', 'hot')
      .neq('station', 'dead')
      .neq('station', 'closed')
      .limit(20)

    // Fetch qualified leads without offers
    const { data: noOfferLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('station', 'qualifying')
      .is('offer_amount', null)
      .not('motivation_score', 'is', null)

    const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()]

    // Build coaching response without LLM for speed/reliability
    if (mode === 'morning') {
      const greeting = buildGreeting(agent, dayOfWeek)
      const nudges = buildNudges({
        calls, smsSent, smsReceived, overdueTasks, todayTasks,
        hotLeadCount: hotLeads?.length || 0,
        noOfferCount: noOfferLeads?.length || 0,
      })
      const momentum = buildMomentum(calls)

      const result = { greeting, nudges, momentum, mode: 'morning' }
      cache = { key: cacheKey, data: result, ts: Date.now() }
      return NextResponse.json(result)
    }

    // EOD mode
    const { count: completedToday } = await supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed')
      .gte('due_date', todayStart.toISOString())

    const completedCount = completedToday ?? 0

    const eodResult = {
      mode: 'eod',
      stats: { calls, smsSent, smsReceived, tasksCompleted: completedCount, totalTasks: todayTasks + completedCount },
      wrapUp: buildEodWrapUp(agent, calls, smsSent, completedCount, todayTasks),
    }
    cache = { key: cacheKey, data: eodResult, ts: Date.now() }
    return NextResponse.json(eodResult)
  } catch (err) {
    console.error('coaching error:', err)
    return NextResponse.json({
      greeting: `Good morning ${agent} — let's have a great day!`,
      nudges: ['Check your call queue for today\'s priorities'],
      momentum: null,
      mode,
    })
  }
}

function buildGreeting(agent: string, day: string): string {
  const greetings: Record<string, string> = {
    Monday: `Happy Monday ${agent} — fresh week, fresh opportunities. Let's set the tone!`,
    Tuesday: `Good morning ${agent} — Tuesday's your day to build momentum.`,
    Wednesday: `Midweek check-in ${agent} — halfway there, keep pushing!`,
    Thursday: `Almost there ${agent} — Thursday is for closing strong.`,
    Friday: `Happy Friday ${agent} — let's close the week strong!`,
    Saturday: `Weekend warrior mode ${agent} — sellers are home, pick up the phone!`,
    Sunday: `Chill day ${agent} — prep your week, review your pipeline.`,
  }
  return greetings[day] || `Good morning ${agent} — let's get after it!`
}

function buildNudges(data: {
  calls: number; smsSent: number; smsReceived: number;
  overdueTasks: number; todayTasks: number;
  hotLeadCount: number; noOfferCount: number;
}): string[] {
  const nudges: string[] = []

  if (data.overdueTasks > 0) {
    nudges.push(`You've got ${data.overdueTasks} overdue follow-up${data.overdueTasks > 1 ? 's' : ''} — knock ${data.overdueTasks > 1 ? 'those' : 'that'} out first`)
  }

  if (data.smsReceived > 0) {
    nudges.push(`${data.smsReceived} inbound text${data.smsReceived > 1 ? 's' : ''} waiting — strike while it's hot`)
  }

  if (data.noOfferCount > 0) {
    nudges.push(`${data.noOfferCount} lead${data.noOfferCount > 1 ? 's are' : ' is'} qualified with no offer yet — money on the table`)
  }

  if (nudges.length === 0 && data.hotLeadCount > 0) {
    nudges.push(`${data.hotLeadCount} hot lead${data.hotLeadCount > 1 ? 's' : ''} in your pipeline — start dialing!`)
  }

  if (nudges.length === 0) {
    nudges.push('Your queue is clear — time to prospect and fill the top of the funnel')
  }

  return nudges.slice(0, 3)
}

function buildMomentum(calls: number): string | null {
  if (calls === 0) return null
  if (calls >= 50) return `You've crushed it — ${calls} dials today! Target hit!`
  if (calls >= 30) return `You've already hit ${calls} dials today — ${50 - calls} more and you crush your target!`
  if (calls >= 10) return `${calls} dials so far — good start, keep the momentum going!`
  return `${calls} dial${calls > 1 ? 's' : ''} in — you're warming up, let's go!`
}

function buildEodWrapUp(agent: string, calls: number, sms: number, tasksCompleted: number, remaining: number): string {
  if (calls >= 50) return `Incredible day ${agent} — ${calls} dials is crushing it. Rest up and come back strong tomorrow.`
  if (calls >= 30) return `Solid day ${agent} — ${calls} dials and ${tasksCompleted} tasks done. Keep that energy going tomorrow.`
  if (calls >= 10) return `Good effort ${agent} — ${calls} dials today. Push for 50 tomorrow and watch the pipeline grow.`
  if (calls > 0) return `${calls} dials today ${agent} — every call counts. Tomorrow, aim higher and start earlier.`
  return `Fresh start tomorrow ${agent} — review your call queue tonight and hit the ground running at 9am.`
}
