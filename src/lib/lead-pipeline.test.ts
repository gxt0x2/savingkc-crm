import { describe, expect, it } from 'vitest'
import { buildManifest } from '@/lib/manifest-builder'
import { promoteLatestAnalyzedTranscriptToManifest } from './lead-pipeline'

describe('lead pipeline transcript intelligence promotion', () => {
  it('promotes an already-analyzed transcript into lead-page manifest sections', () => {
    const manifest = buildManifest({
      firstName: 'Stuart',
      source: 'ppc-landing',
      station: 'appointment_set',
      priority: 'hot',
      propertyAddress: '59 E 107th St',
    })

    manifest.situation.summary = 'PPC intake: reason: Property condition is the issue.'
    manifest.communications = {
      transcripts: [
        {
          id: 'twilio-RE123',
          date: '2026-06-06T20:00:00.000Z',
          duration: 895,
          agent: 'Casey',
          recordingUrl: 'https://api.twilio.com/recordings/RE123',
          fullTranscript: 'Long seller call transcript',
          aiSummary:
            'Stuart wants to sell as-is because he is out of work, wants to downsize, and the property needs foundation and electrical work.',
          extractedData: {
            motivationScore: 8,
            sentiment: 'neutral',
            rapportLevel: 'medium',
            concessionSignals: ['Financial distress', 'Repairs needed', 'Foundation issues'],
            objectionResponses: ['Foundation issues', 'Aluminum wiring'],
            nextSteps: ['Prepare for appointment and verify repair scope'],
          },
        },
      ],
    }

    const changed = promoteLatestAnalyzedTranscriptToManifest(manifest)

    expect(changed).toContain('seller_situation')
    expect(manifest.situation.summary).toContain('sell as-is')
    expect(manifest.situation.motivation?.score).toBe(8)
    expect(manifest.situation.motivation?.signals).toEqual(
      expect.arrayContaining(['Financial distress', 'Repairs needed', 'Foundation issues']),
    )
    expect(manifest.situation.objections).toEqual(
      expect.arrayContaining(['Foundation issues', 'Aluminum wiring']),
    )
    expect(manifest.flags.opportunityFlags).toEqual(
      expect.arrayContaining(['Financial distress', 'Repairs needed', 'Foundation issues']),
    )
    expect(manifest.ariIntelligence?.dealIntelligence?.keyLeverage).toEqual(
      expect.arrayContaining(['Financial distress', 'Repairs needed', 'Foundation issues']),
    )
    expect(manifest.ariIntelligence?.recommendedActions?.[0].action).toBe(
      'Prepare for appointment and verify repair scope',
    )
  })
})
