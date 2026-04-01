/** Stub — analyze call transcript with AI */
export interface CallAnalysisResult {
  summary: string
  sentiment: string
  nextSteps: string[]
  isHotLead: boolean
}

export async function analyzeCallTranscript(_transcript: string): Promise<CallAnalysisResult> {
  throw new Error('mojo-call-analyzer not yet implemented')
}
