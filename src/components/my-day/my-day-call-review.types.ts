import type { CallReviewFrameworkId } from '@/lib/call-review-frameworks'

export type Workflow = {
  status: 'available' | 'submitted' | 'completed'
  framework: CallReviewFrameworkId | null
  score: number | null
  criticalScore?: number | null
  needsCoaching?: boolean
  coachingReasons?: string[]
  scoringVersion?: string | null
  submittedBy: string | null
  assignedReviewer: string | null
  submissionNote?: string | null
  completedBy?: string | null
  reviewNote?: string | null
  answers?: Record<string, number>
  tags: string[]
  voiceoverPath?: string | null
  voiceoverMimeType?: string | null
  aiStatus?: 'idle' | 'processing' | 'ready' | 'failed'
  aiProcessedAt?: string | null
  aiModel?: string | null
  aiError?: string | null
  aiScore?: number | null
  aiCriticalScore?: number | null
  aiAnswers?: Record<
    string,
    {
      score: number
      confidence: 'low' | 'medium' | 'high'
      evidence: string
      timestamp: string | null
      reasoning: string
    }
  >
  aiCorrections?: string[]
}

export type ReviewCall = {
  id: string
  leadName: string
  recordingUrl: string
  durationSeconds: number
  analysisSummary: string | null
  reviewWorkflow: Workflow
  previewLocal?: boolean
}
