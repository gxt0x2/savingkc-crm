import { z } from 'zod'

import {
  getCallReviewFramework,
  type CallReviewFramework,
} from '@/lib/call-review-frameworks'
import { scoreCallReview } from '@/lib/call-review-scoring'
import {
  compactTranscript,
  mergeCallReviewWorkflow,
  readCallReviewWorkflow,
  readRecordingSid,
  record,
} from '@/lib/marketing/call-recordings'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const CALL_REVIEW_AI_MODEL = 'llama-3.3-70b-versatile'

const assessmentSchema = z.object({
  id: z.string(),
  score: z.number().min(0).max(3),
  confidence: z.enum(['low', 'medium', 'high']),
  evidence: z.string(),
  timestamp: z.string().nullable().optional(),
  reasoning: z.string(),
})

const responseSchema = z.object({ assessments: z.array(assessmentSchema) })

type ActivityRow = {
  id: string
  lead_id: string | null
  description: string | null
  metadata: unknown
  created_at: string | null
}

function extractJson(value: string) {
  const match = value.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('AI scorecard response did not contain JSON')
  return JSON.parse(match[0]) as unknown
}

export async function generateAiCallReview(
  transcript: string,
  framework: CallReviewFramework,
  request: typeof fetch = fetch,
) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('AI scoring is not configured')

  const items = framework.sections.flatMap((section) =>
    section.items.map((item) => ({ section: section.label, ...item })),
  )
  const prompt = `You are a strict sales-call quality analyst for Saving KC Homebuyers. Score only what is demonstrated in the transcript.

RUBRIC:
0 = Missed / not demonstrated
1 = Attempted but incomplete or inconsistent
2 = Meets standard: clear, complete, and effective
3 = Excellent: intentional, natural, and repeatable

RULES:
- Return one assessment for every item ID below.
- Never infer missing behavior. If the transcript does not prove it, score 0.
- Evidence must be a short verbatim excerpt from the transcript. Use an empty string when absent.
- Only provide a timestamp when the transcript itself includes one; otherwise use null.
- Confidence describes confidence that the evidence supports the score, not call quality.
- Output JSON only: {"assessments":[{"id":"...","score":0,"confidence":"low","evidence":"","timestamp":null,"reasoning":"..."}]}

SCORECARD ITEMS:
${JSON.stringify(items)}

TRANSCRIPT:
${transcript.slice(0, 30000)}`

  const response = await request(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CALL_REVIEW_AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 6000,
      }),
    },
  )
  if (!response.ok) throw new Error(`AI scoring failed (${response.status})`)

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const parsed = responseSchema.parse(
    extractJson(payload.choices?.[0]?.message?.content || ''),
  )
  const byId = new Map(
    parsed.assessments.map((assessment) => [assessment.id, assessment]),
  )
  const aiAnswers = Object.fromEntries(
    items.map((item) => {
      const assessment = byId.get(item.id)
      return [
        item.id,
        assessment
          ? {
              score: Math.round(assessment.score),
              confidence: assessment.confidence,
              evidence: assessment.evidence.trim(),
              timestamp: assessment.timestamp?.trim() || null,
              reasoning: assessment.reasoning.trim(),
            }
          : {
              score: 0,
              confidence: 'low' as const,
              evidence: '',
              timestamp: null,
              reasoning: 'The AI response did not assess this item.',
            },
      ]
    }),
  )
  const scoring = scoreCallReview(
    framework,
    Object.fromEntries(
      Object.entries(aiAnswers).map(([id, answer]) => [id, answer.score]),
    ),
  )

  return { aiAnswers, scoring, model: CALL_REVIEW_AI_MODEL }
}

async function updateAiFailure(activity: ActivityRow, message: string) {
  const workflow = readCallReviewWorkflow(activity.metadata)
  if (workflow.status !== 'submitted') return
  await supabaseAdmin()
    .from('lead_activities')
    .update({
      metadata: mergeCallReviewWorkflow(activity.metadata, {
        aiStatus: 'failed',
        aiProcessedAt: new Date().toISOString(),
        aiError: message.slice(0, 500),
      }),
    })
    .eq('id', activity.id)
}

export async function processCallReviewAi(activityId: string) {
  const db = supabaseAdmin()
  const { data } = await db
    .from('lead_activities')
    .select('id, lead_id, description, metadata, created_at')
    .eq('id', activityId)
    .maybeSingle()
  const activity = data as ActivityRow | null
  if (!activity) return

  try {
    const workflow = readCallReviewWorkflow(activity.metadata)
    if (workflow.status !== 'submitted') return
    const framework = getCallReviewFramework(workflow.framework)
    if (!framework) throw new Error('Scorecard framework is unavailable')
    if (!activity.lead_id)
      throw new Error('Call is not linked to a contact transcript')

    const { data: notes } = await db
      .from('lead_activities')
      .select('id, lead_id, description, metadata, created_at')
      .eq('lead_id', activity.lead_id)
      .eq('activity_type', 'note')
      .eq('metadata->>source', 'whisper_transcription')
      .order('created_at', { ascending: false })
      .limit(20)

    const sid = readRecordingSid(activity.metadata)
    const transcriptRow =
      ((notes || []) as ActivityRow[]).find(
        (row) => sid && readRecordingSid(row.metadata) === sid,
      ) ||
      ((notes || []) as ActivityRow[]).find((row) => {
        const callTime = Date.parse(activity.created_at || '')
        const noteTime = Date.parse(row.created_at || '')
        return (
          Number.isFinite(callTime) &&
          Number.isFinite(noteTime) &&
          Math.abs(noteTime - callTime) <= 45 * 60 * 1000
        )
      })
    const transcript = compactTranscript(
      record(transcriptRow?.metadata).fullTranscript,
      transcriptRow?.description || '',
    )
    if (transcript.length < 30)
      throw new Error(
        'Transcript is not ready; retry AI scoring after transcription completes',
      )

    const result = await generateAiCallReview(transcript, framework)
    const { data: latest } = await db
      .from('lead_activities')
      .select('id, metadata')
      .eq('id', activity.id)
      .maybeSingle()
    const latestActivity = latest as Pick<ActivityRow, 'id' | 'metadata'> | null
    if (
      !latestActivity ||
      readCallReviewWorkflow(latestActivity.metadata).status !== 'submitted'
    )
      return

    await db
      .from('lead_activities')
      .update({
        metadata: mergeCallReviewWorkflow(latestActivity.metadata, {
          aiStatus: 'ready',
          aiProcessedAt: new Date().toISOString(),
          aiModel: result.model,
          aiError: null,
          aiScore: result.scoring.score,
          aiCriticalScore: result.scoring.criticalScore,
          aiAnswers: result.aiAnswers,
        }),
      })
      .eq('id', activity.id)
  } catch (error) {
    await updateAiFailure(
      activity,
      error instanceof Error ? error.message : 'AI scoring failed',
    )
  }
}
