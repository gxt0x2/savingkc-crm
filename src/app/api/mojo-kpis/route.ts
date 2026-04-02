import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

interface MojoResult {
  analysis?: {
    motivation_level?: number
    lead_quality?: string
  }
}

interface MojoFile {
  date?: string
  total_recordings?: number
  meaningful_calls?: number
  results?: MojoResult[]
}

function parseMojoFile(filePath: string): MojoFile | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function analyzeResults(data: MojoFile) {
  const results = data.results || []
  const totalCalls = data.total_recordings ?? results.length
  const meaningfulCalls = data.meaningful_calls ?? results.filter(
    (r) => r.analysis?.motivation_level && r.analysis.motivation_level >= 3
  ).length
  const motivationScores = results
    .map((r) => r.analysis?.motivation_level)
    .filter((s): s is number => typeof s === 'number')
  const avgMotivation = motivationScores.length > 0
    ? Math.round((motivationScores.reduce((a, b) => a + b, 0) / motivationScores.length) * 10) / 10
    : 0
  const hotLeads = results.filter(
    (r) => r.analysis?.lead_quality === 'hot' || (r.analysis?.motivation_level ?? 0) >= 7
  ).length

  return { totalCalls, meaningfulCalls, avgMotivation, hotLeads }
}

export async function GET(req: NextRequest) {
  try {
    const memoryDir = join(
      process.env.HOME || '/Users/ernestdodson',
      '.openclaw/workspace/memory'
    )

    const since = req.nextUrl.searchParams.get('since') // e.g. "2026-02-01"

    const files = readdirSync(memoryDir)
      .filter(f => f.startsWith('mojo-calls-') && f.endsWith('.json'))
      .sort()
      .reverse()

    if (files.length === 0) {
      return NextResponse.json({
        totalCalls: 0, meaningfulCalls: 0, avgMotivation: 0, hotLeads: 0,
        cumulative: { totalCalls: 0, meaningfulCalls: 0, hotLeads: 0, days: 0 },
      })
    }

    // Latest day (existing behavior)
    const latestData = parseMojoFile(join(memoryDir, files[0]))
    const latest = latestData ? analyzeResults(latestData) : { totalCalls: 0, meaningfulCalls: 0, avgMotivation: 0, hotLeads: 0 }

    // Cumulative since date
    const sinceDate = since || '2026-02-01'
    let cumTotalCalls = 0
    let cumMeaningfulCalls = 0
    let cumHotLeads = 0
    let cumDays = 0

    for (const file of files) {
      // Extract date from filename: mojo-calls-2026-03-20.json
      const dateMatch = file.match(/mojo-calls-(\d{4}-\d{2}-\d{2})/)
      if (!dateMatch) continue
      const fileDate = dateMatch[1]
      if (fileDate < sinceDate) continue

      const data = parseMojoFile(join(memoryDir, file))
      if (!data) continue

      const stats = analyzeResults(data)
      cumTotalCalls += stats.totalCalls
      cumMeaningfulCalls += stats.meaningfulCalls
      cumHotLeads += stats.hotLeads
      cumDays++
    }

    return NextResponse.json({
      date: latestData?.date,
      ...latest,
      cumulative: {
        since: sinceDate,
        totalCalls: cumTotalCalls,
        meaningfulCalls: cumMeaningfulCalls,
        hotLeads: cumHotLeads,
        days: cumDays,
      },
    })
  } catch (err) {
    console.error('mojo-kpis route error:', err)
    return NextResponse.json(
      { totalCalls: 0, meaningfulCalls: 0, avgMotivation: 0, hotLeads: 0, cumulative: { totalCalls: 0, meaningfulCalls: 0, hotLeads: 0, days: 0 } },
      { status: 200 }
    )
  }
}
