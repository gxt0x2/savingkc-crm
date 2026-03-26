import { NextResponse } from 'next/server'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

export async function GET() {
  try {
    const memoryDir = join(
      process.env.HOME || '/Users/ernestdodson',
      '.openclaw/workspace/memory'
    )

    // Find the most recent mojo-calls-*.json file
    const files = readdirSync(memoryDir)
      .filter(f => f.startsWith('mojo-calls-') && f.endsWith('.json'))
      .sort()
      .reverse()

    if (files.length === 0) {
      // No mojo files found, return zeros
      return NextResponse.json({
        totalCalls: 0,
        meaningfulCalls: 0,
        avgMotivation: 0,
        hotLeads: 0,
      })
    }

    const filePath = join(memoryDir, files[0])

    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)

    const results: Array<{
      analysis?: {
        motivation_level?: number
        lead_quality?: string
      }
    }> = data.results || []

    const totalCalls = data.total_recordings ?? results.length
    const meaningfulCalls = data.meaningful_calls ?? results.filter(
      (r) => r.analysis?.motivation_level && r.analysis.motivation_level >= 3
    ).length

    const motivationScores = results
      .map((r) => r.analysis?.motivation_level)
      .filter((s): s is number => typeof s === 'number')

    const avgMotivation =
      motivationScores.length > 0
        ? Math.round((motivationScores.reduce((a, b) => a + b, 0) / motivationScores.length) * 10) / 10
        : 0

    const hotLeads = results.filter(
      (r) => r.analysis?.lead_quality === 'hot' || (r.analysis?.motivation_level ?? 0) >= 7
    ).length

    return NextResponse.json({
      date: data.date,
      totalCalls,
      meaningfulCalls,
      avgMotivation,
      hotLeads,
    })
  } catch (err) {
    console.error('mojo-kpis route error:', err)
    return NextResponse.json(
      { totalCalls: 0, meaningfulCalls: 0, avgMotivation: 0, hotLeads: 0 },
      { status: 200 }
    )
  }
}
