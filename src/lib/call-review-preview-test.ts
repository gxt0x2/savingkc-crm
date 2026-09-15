import type { ReviewCall } from '@/components/my-day/my-day-call-review.types'

export function previewMicrophoneTestCall(viewerEmail: string): ReviewCall {
  return {
    id: 'preview-microphone-mix-test',
    leadName: 'MICROPHONE MIX TEST - Preview only',
    recordingUrl: '/audio/ivr-voicemail.mp3',
    durationSeconds: 5,
    analysisSummary: 'Speak while this bundled sample plays, then verify that both voices are audible in the completed coaching review.',
    previewLocal: true,
    reviewWorkflow: {
      status: 'submitted',
      framework: 'junior_acquisitions',
      score: null,
      submittedBy: 'preview-user',
      assignedReviewer: viewerEmail,
      submissionNote: 'Safe microphone and mixed-audio verification; no CRM data will be changed.',
      tags: ['Preview', 'Microphone test'],
      aiStatus: 'failed',
      aiError: 'Preview test calls are scored manually.',
    },
  }
}
