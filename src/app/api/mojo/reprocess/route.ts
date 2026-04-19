/**
 * POST /api/mojo/reprocess
 * Re-process pending transcriptions for a specific lead or all leads.
 * Picks up calls that have recordingUrl but no fullTranscript.
 *
 * Body: { leadId?: string } — if omitted, processes all pending transcripts
 */
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

import type { ManifestV2 } from '@/lib/manifest-builder'
import { downloadRecording } from '@/lib/mojo-recording-downloader'
import { transcribeAudio } from '@/lib/mojo-transcriber'
import { analyzeCallTranscript, type CallAnalysisResult } from '@/lib/mojo-call-analyzer'
import type { ManifestOwner, ManifestProperty, ManifestSituation } from '@/lib/manifest-builder'



export async function POST(req: Request) {
  try {
    const { leadId } = await req.json().catch(() => ({}))

    // Find manifests with pending transcripts
    let query = supabase
      .from('manifests')
      .select('id, lead_id, manifest')

    if (leadId) {
      query = query.eq('lead_id', leadId)
    }

    const { data: rows } = await query

    if (!rows || rows.length === 0) {
      return NextResponse.json({ message: 'No manifests found', processed: 0 })
    }

    let processed = 0
    const results: any[] = []

    for (const row of rows) {
      const manifest = row.manifest as ManifestV2
      const transcripts = manifest.communications?.transcripts || []
      const pending = transcripts.filter(t => t.recordingUrl && (!t.fullTranscript || t.transcriptionPending))

      if (pending.length === 0) continue

      for (const t of pending) {
        try {
          console.log(`Processing transcript ${t.id} for lead ${row.lead_id} (${t.duration}s call)`)

          // Step 1: Download
          const audioPath = await downloadRecording(t.recordingUrl!, t.id)

          // Step 2: Transcribe
          const transcriptText = await transcribeAudio(audioPath)

          if (!transcriptText) {
            results.push({ id: t.id, status: 'empty_transcript' })
            continue
          }

          // Step 3: Analyze
          let analysis: CallAnalysisResult | null = null
          try {
            analysis = await analyzeCallTranscript(transcriptText, manifest)
          } catch (e) {
            console.error('Analysis failed for', t.id, e)
          }

          // Step 4: Update the transcript entry in place
          t.fullTranscript = transcriptText
          t.transcriptionPending = false
          t.analysisPending = false
          t.aiSummary = analysis?.aiSummary || null

          if (analysis) {
            t.extractedData = {
              motivationScore: analysis.motivationScore,
              sentiment: analysis.sentiment as any,
              rapportLevel: analysis.rapportLevel as any,
              talkRatio: null,
              verbatimQuotes: analysis.verbatimQuotes,
              objectionResponses: analysis.objectionsRaised,
              concessionSignals: analysis.keyLeverage,
              agentCoaching: {
                strengths: analysis.agentStrengths,
                improvements: analysis.agentImprovements,
              },
            }

            // Update manifest intelligence from analysis
            if (analysis.personalityType && !manifest.owner.personalityType) {
              manifest.owner.personalityType = analysis.personalityType as ManifestOwner['personalityType']
            }
            if (analysis.communicationStyle) {
              if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
              if (!manifest.ariIntelligence.sellerProfile) manifest.ariIntelligence.sellerProfile = {}
              manifest.ariIntelligence.sellerProfile.communicationStyle = analysis.communicationStyle
              manifest.ariIntelligence.sellerProfile.personalityType = analysis.personalityType
              if (analysis.decisionStyle) manifest.ariIntelligence.sellerProfile.decisionStyle = analysis.decisionStyle
              if (analysis.emotionalDrivers) manifest.ariIntelligence.sellerProfile.emotionalDrivers = analysis.emotionalDrivers
            }
            if (analysis.dealConfidenceScore) {
              if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
              if (!manifest.ariIntelligence.dealIntelligence) manifest.ariIntelligence.dealIntelligence = {}
              manifest.ariIntelligence.dealIntelligence.confidenceScore = analysis.dealConfidenceScore
              if (analysis.keyLeverage) manifest.ariIntelligence.dealIntelligence.keyLeverage = analysis.keyLeverage
            }
            if (analysis.motivationScore && manifest.situation?.motivation) {
              manifest.situation.motivation.score = analysis.motivationScore
            }
            if (analysis.urgency && manifest.situation?.timeline) {
              manifest.situation.timeline.urgency = analysis.urgency as any
            }
            if (analysis.situationType?.length) {
              for (const tag of analysis.situationType) {
                if (!manifest.situation.type.includes(tag)) manifest.situation.type.push(tag)
              }
            }
            if (analysis.conditionOverall && !manifest.property.condition?.overall) {
              if (!manifest.property.condition) manifest.property.condition = {}
              manifest.property.condition.overall = analysis.conditionOverall as any
            }
            if (analysis.vacant !== undefined) manifest.property.vacant = analysis.vacant
            if (analysis.occupancy && !manifest.property.occupancy) {
              manifest.property.occupancy = analysis.occupancy as ManifestProperty['occupancy']
            }
          }

          // Mark briefing stale
          if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
          manifest.ariIntelligence.briefingStale = true
          manifest.lastUpdated = new Date().toISOString()
          manifest.lastUpdatedBy = 'system:reprocess'

          manifest.auditTrail.push({
            timestamp: new Date().toISOString(),
            agent: 'system:reprocess',
            action: 'transcript_reprocessed',
            details: {
              transcriptId: t.id,
              duration: t.duration,
              hasTranscript: true,
              hasAnalysis: !!analysis,
              motivationScore: analysis?.motivationScore,
              sentiment: analysis?.sentiment,
            },
          })

          processed++
          results.push({
            id: t.id,
            status: 'success',
            transcriptLength: transcriptText.length,
            hasAnalysis: !!analysis,
            motivationScore: analysis?.motivationScore,
            sentiment: analysis?.sentiment,
            quotesCount: analysis?.verbatimQuotes?.length || 0,
          })
        } catch (err: any) {
          console.error('Reprocess failed for transcript', t.id, err)
          results.push({ id: t.id, status: 'error', error: err.message })
        }
      }

      // Save the updated manifest
      await supabase
        .from('manifests')
        .update({
          manifest,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
    }

    return NextResponse.json({ processed, results })
  } catch (err: any) {
    console.error('Reprocess error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
