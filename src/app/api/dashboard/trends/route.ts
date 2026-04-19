import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'




/**
 * GET /api/dashboard/trends?period=daily|weekly|monthly&days=30
 *
 * Returns time-series data for dashboard comparison charts.
 * Each bucket contains: calls, sms_sent, sms_received, leads_created, tasks_completed
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const period = searchParams.get('period') || 'daily'
  const days = Math.min(parseInt(searchParams.get('days') || '30'), 180)

  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceISO = since.toISOString()

  // Fetch lead activities (calls, sms)
  const { data: activities } = await supabase
    .from('lead_activities')
    .select('type, direction, created_at')
    .gte('created_at', sinceISO)
    .order('created_at', { ascending: true })

  // Fetch leads created
  const { data: leads } = await supabase
    .from('leads')
    .select('created_at')
    .gte('created_at', sinceISO)
    .order('created_at', { ascending: true })

  // Fetch tasks completed
  const { data: tasks } = await supabase
    .from('tasks')
    .select('completed_at')
    .not('completed_at', 'is', null)
    .gte('completed_at', sinceISO)
    .order('completed_at', { ascending: true })

  // Build buckets
  const buckets = new Map<string, {
    label: string
    calls: number
    sms_sent: number
    sms_received: number
    leads_created: number
    tasks_completed: number
  }>()

  function getBucketKey(dateStr: string): string {
    const d = new Date(dateStr)
    if (period === 'monthly') {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    if (period === 'weekly') {
      // ISO week: Monday-based
      const jan1 = new Date(d.getFullYear(), 0, 1)
      const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000)
      const week = Math.ceil((dayOfYear + jan1.getDay() + 1) / 7)
      return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`
    }
    // daily
    return d.toISOString().slice(0, 10)
  }

  function getBucketLabel(key: string): string {
    if (period === 'monthly') {
      const [y, m] = key.split('-')
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      return `${months[parseInt(m) - 1]} ${y}`
    }
    if (period === 'weekly') return key
    // daily: "Apr 1"
    const d = new Date(key + 'T12:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  function ensureBucket(dateStr: string) {
    const key = getBucketKey(dateStr)
    if (!buckets.has(key)) {
      buckets.set(key, { label: getBucketLabel(key), calls: 0, sms_sent: 0, sms_received: 0, leads_created: 0, tasks_completed: 0 })
    }
    return buckets.get(key)!
  }

  // Fill activities
  for (const a of activities || []) {
    const b = ensureBucket(a.created_at)
    if (a.type === 'call') b.calls++
    else if (a.type === 'sms' && a.direction === 'outbound') b.sms_sent++
    else if (a.type === 'sms' && a.direction === 'inbound') b.sms_received++
  }

  // Fill leads
  for (const l of leads || []) {
    ensureBucket(l.created_at).leads_created++
  }

  // Fill tasks
  for (const t of tasks || []) {
    ensureBucket(t.completed_at).tasks_completed++
  }

  // Sort buckets by key
  const sorted = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)

  return NextResponse.json({ period, days, buckets: sorted })
}
