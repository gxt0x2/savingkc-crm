/** Stub — build Ari briefing prompt from manifest data */
export interface BriefingResult {
  briefing: string
  priority: string
  actionItems: string[]
}

export function buildManifestBriefingPrompt(_manifestData: unknown): string {
  return ''
}
