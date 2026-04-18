# Manifest V2 Shape Analysis — 2026-04-18

Probed all 178 manifests in the `manifests` table to inform the Phase 7 `transformToV2_1` design. This is read-only analysis — no writes.

## Summary

- Total manifests: **178**
- Self-nested (`manifest.manifest.*`): **2** (1%)
- With embedded transcripts: **142** (80%)

## Version field distribution (inner `manifest.version`)

| Value | Count | Pct |
|---|---|---|
| `2` | 164 | 92% |
| `2.0` | 14 | 8% |

## `currentStation` distribution

| Value | Count | Pct |
|---|---|---|
| `intake` | 111 | 62% |
| `qualifying` | 46 | 26% |
| `appointment` | 10 | 6% |
| `contacted` | 10 | 6% |
| `qualification` | 1 | 1% |

## `priority` distribution

| Value | Count | Pct |
|---|---|---|
| `warm` | 97 | 54% |
| `cold` | 66 | 37% |
| `hot` | 10 | 6% |
| `normal` | 5 | 3% |

## Life event type distribution

| Value | Count | Pct |
|---|---|---|
| `(missing/unset)` | 177 | 99% |
| `probate` | 1 | 1% |

## Every path populated, by frequency

Paths ordered by how many manifests have them populated (non-null, non-empty).
Paths with <5% population are candidates for "rarely set — transform can omit
and let downstream systems re-compute."

| Path | Count | Pct |
|---|---|---|
| `owner` | 178 | 100% |
| `owner.lastName` | 178 | 100% |
| `owner.firstName` | 178 | 100% |
| `version` | 178 | 100% |
| `priority` | 178 | 100% |
| `property` | 178 | 100% |
| `situation` | 178 | 100% |
| `auditTrail` | 178 | 100% |
| `lastUpdated` | 178 | 100% |
| `lastUpdatedBy` | 178 | 100% |
| `currentStation` | 178 | 100% |
| `flags` | 177 | 99% |
| `communications` | 177 | 99% |
| `ariIntelligence` | 172 | 97% |
| `ariIntelligence.briefingStale` | 172 | 97% |
| `owner.deceased` | 171 | 96% |
| `situation.motivation` | 167 | 94% |
| `owner.fullName` | 164 | 92% |
| `owner.outOfState` | 164 | 92% |
| `source` | 164 | 92% |
| `booking` | 164 | 92% |
| `booking.type` | 164 | 92% |
| `created` | 164 | 92% |
| `manifestId` | 164 | 92% |
| `deal` | 163 | 92% |
| `deal.status` | 163 | 92% |
| `pipeline` | 163 | 92% |
| `pipeline.offer` | 163 | 92% |
| `pipeline.offer.status` | 163 | 92% |
| `pipeline.closed` | 163 | 92% |
| `pipeline.closed.status` | 163 | 92% |
| `pipeline.intake` | 163 | 92% |
| `pipeline.intake.notes` | 163 | 92% |
| `pipeline.intake.status` | 163 | 92% |
| `pipeline.intake.completedAt` | 163 | 92% |
| `pipeline.closing` | 163 | 92% |
| `pipeline.closing.status` | 163 | 92% |
| `pipeline.contract` | 163 | 92% |
| `pipeline.contract.status` | 163 | 92% |
| `pipeline.research` | 163 | 92% |
| `pipeline.research.status` | 163 | 92% |
| `pipeline.discovery` | 163 | 92% |
| `pipeline.discovery.status` | 163 | 92% |
| `pipeline.valuation` | 163 | 92% |
| `pipeline.valuation.status` | 163 | 92% |
| `pipeline.inspection` | 163 | 92% |
| `pipeline.inspection.status` | 163 | 92% |
| `pipeline.qualifying` | 163 | 92% |
| `pipeline.qualifying.status` | 163 | 92% |
| `pipeline.closing_prep` | 163 | 92% |
| `pipeline.closing_prep.status` | 163 | 92% |
| `pipeline.negotiations` | 163 | 92% |
| `pipeline.negotiations.status` | 163 | 92% |
| `situation.timeline` | 163 | 92% |
| `booking.confirmedAt` | 162 | 91% |
| `contacts` | 162 | 91% |
| `property.address` | 146 | 82% |
| `communications.transcripts` | 142 | 80% |
| `owner.phones` | 140 | 79% |
| `situation.motivation.score` | 133 | 75% |
| `ariIntelligence.sellerProfile` | 113 | 63% |
| `ariIntelligence.sellerProfile.communicationStyle` | 112 | 63% |
| `owner.personalityType` | 111 | 62% |
| `situation.timeline.urgency` | 111 | 62% |
| `ariIntelligence.sellerProfile.personalityType` | 111 | 62% |
| `ariIntelligence.sellerProfile.decisionStyle` | 110 | 62% |
| `situation.type` | 102 | 57% |
| `ariIntelligence.sellerProfile.emotionalDrivers` | 100 | 56% |
| `ariIntelligence.dealIntelligence` | 94 | 53% |
| `ariIntelligence.dealIntelligence.confidenceScore` | 94 | 53% |
| `property.state` | 86 | 48% |
| `property.city` | 84 | 47% |
| `ariIntelligence.dealIntelligence.keyLeverage` | 77 | 43% |
| `ariIntelligence.biggestObstacle` | 69 | 39% |
| `ariIntelligence.recommendedNextStep` | 69 | 39% |
| `ariIntelligence.recommendedActions` | 68 | 38% |
| `ariIntelligence.lastBriefing` | 65 | 37% |
| `ariIntelligence.lastBriefing.strategy` | 65 | 37% |
| `ariIntelligence.lastBriefing.situation` | 65 | 37% |
| `ariIntelligence.lastBriefing.motivation` | 65 | 37% |
| `ariIntelligence.lastBriefing.generatedAt` | 65 | 37% |
| `ariIntelligence.lastBriefing.generatedFrom` | 64 | 36% |
| `property.vacant` | 63 | 35% |
| `property.occupancy` | 62 | 35% |
| `property.condition` | 50 | 28% |
| `situation.summary` | 50 | 28% |
| `property.condition.overall` | 49 | 28% |
| `situation.motivationLevel` | 47 | 26% |
| `situation.priceExpectations` | 35 | 20% |
| `situation.priceExpectations.priceFlexibility` | 35 | 20% |
| `ariIntelligence.hotSignal` | 34 | 19% |
| `ariIntelligence.hotNextMove` | 34 | 19% |
| `ariIntelligence.hotSignalGeneratedAt` | 34 | 19% |
| `situation.timeline.hardDeadline` | 30 | 17% |
| `agentNotes` | 30 | 17% |
| `notes` | 23 | 13% |
| `property.parcel` | 23 | 13% |
| `situation.objections` | 23 | 13% |
| `owner.bestTimeToContact` | 22 | 12% |
| `flags.opportunityFlags` | 21 | 12% |
| `property.dwelling` | 21 | 12% |
| `property.dwelling.sqft` | 21 | 12% |
| `property.dwelling.bedrooms` | 21 | 12% |
| `property.dwelling.bathrooms` | 21 | 12% |
| `property.dwelling.yearBuilt` | 21 | 12% |
| `property.assessment` | 21 | 12% |
| `property.assessment.totalValue` | 21 | 12% |
| `property.taxCollector` | 21 | 12% |
| `property.taxCollector.delinquentAmount` | 21 | 12% |
| `situation.motivation.signals` | 21 | 12% |
| `property.taxCollector.totalOwed` | 20 | 11% |
| `property.taxCollector.yearsDelinquent` | 19 | 11% |
| `property.condition.notes` | 18 | 10% |
| `property.dwelling.style` | 17 | 10% |
| `financials` | 16 | 9% |
| `pipeline.appointment` | 16 | 9% |
| `pipeline.appointment.type` | 16 | 9% |
| `pipeline.appointment.status` | 16 | 9% |
| `pipeline.appointment.createdAt` | 16 | 9% |
| `pipeline.appointment.assignedTo` | 16 | 9% |
| `pipeline.appointment.scheduledAt` | 16 | 9% |
| `pipeline.appointment.appointmentId` | 16 | 9% |
| `pipeline.appointment.ghostRiskScore` | 16 | 9% |
| `pipeline.appointment.confirmationCount` | 16 | 9% |
| `pipeline.appointment.ghostProtocolActive` | 16 | 9% |
| `pipeline.appointment.notes` | 15 | 8% |
| `owner.phone` | 14 | 8% |
| `qualificationScore` | 14 | 8% |
| `situation.timeline.targetCloseDate` | 14 | 8% |
| `communications.responsePending` | 14 | 8% |
| `communications.totalTouchpoints` | 14 | 8% |
| `communications.lastConversationCloser` | 14 | 8% |
| `communications.outreachAttemptsSinceLastResponse` | 14 | 8% |
| `booking.location` | 13 | 7% |
| `booking.assignedAgent` | 13 | 7% |
| `tier` | 13 | 7% |
| `scoring` | 13 | 7% |
| `scoring.reasoning` | 13 | 7% |
| `scoring.scored_at` | 13 | 7% |
| `scoring.scored_by` | 13 | 7% |
| `scoring.classification` | 13 | 7% |
| `scoring.worth_enriching` | 13 | 7% |
| `scoring.opportunity_score` | 13 | 7% |
| `communications.thankYouSms` | 13 | 7% |
| `communications.thankYouSms.to` | 13 | 7% |
| `communications.thankYouSms.sent` | 13 | 7% |
| `communications.thankYouSms.sentAt` | 13 | 7% |
| `communications.thankYouSms.template` | 13 | 7% |
| `situation.blockers` | 13 | 7% |
| `financials.back_taxes` | 13 | 7% |
| `situation.priceExpectations.priceAnchor` | 13 | 7% |
| `booking.scheduledDate` | 12 | 7% |
| `booking.scheduledTime` | 12 | 7% |
| `property.dwelling.source` | 12 | 7% |
| `property.dwelling.fetchedAt` | 12 | 7% |
| `property.dwelling.propertyType` | 12 | 7% |
| `property.assessment.source` | 12 | 7% |
| `property.assessment.fetchedAt` | 12 | 7% |
| `property.assessment.assessedTotal` | 12 | 7% |
| `property.assessment.appraisedTotal` | 12 | 7% |
| `property.assessment.assessmentYear` | 12 | 7% |
| `property.assessment.landValue` | 11 | 6% |
| `property.assessment.improvementValue` | 11 | 6% |
| `lastCallDate` | 11 | 6% |
| `communications.lastDisposition` | 11 | 6% |
| `communications.lastOutboundDate` | 11 | 6% |
| `communications.lastDispositionDate` | 11 | 6% |
| `property.dwelling.exterior` | 10 | 6% |
| `property.dwelling.roofType` | 10 | 6% |
| `situation.timeline.deadlineReason` | 10 | 6% |
| `property.taxCollector.source` | 9 | 5% |
| `property.taxCollector.fetchedAt` | 9 | 5% |
| `property.taxCollector.taxStatus` | 9 | 5% |
| `financials.arv` | 9 | 5% |
| `pipeline.qualifying.enteredAt` | 9 | 5% |
| `flags.redFlags` | 8 | 4% |
| `property.zip` | 8 | 4% |
| `pipeline.qualifying.completedAt` | 8 | 4% |
| `financials.arv_source` | 7 | 4% |
| `situation.priceExpectations.sellerAsking` | 7 | 4% |
| `property.dwelling.hvac` | 6 | 3% |
| `property.dwelling.basement` | 6 | 3% |
| `property.dwelling.totalRooms` | 6 | 3% |
| `property.taxCollector.pastYearsDue` | 6 | 3% |
| `property.taxCollector.delinquentYears` | 6 | 3% |
| `property.taxCollector.currentAmountDue` | 6 | 3% |
| `property.dwelling.hasFireplace` | 5 | 3% |
| `property.taxCollector.status` | 5 | 3% |
| `communications.lastSellerContactDate` | 5 | 3% |
| `is_favorite` | 5 | 3% |
| `situation.priceExpectations.sellerFloor` | 5 | 3% |
| `lastTextDate` | 5 | 3% |
| `communications.totalInboundContacts` | 4 | 2% |
| `property.dwelling.finishedBasementSqft` | 3 | 2% |
| `owner.relationshipToProperty` | 3 | 2% |
| `situation.painPoints` | 3 | 2% |
| `communications.lastInboundDate` | 3 | 2% |
| `communications.daysSinceLastSellerResponse` | 3 | 2% |
| `owner.email` | 3 | 2% |
| `owner.coOwners` | 3 | 2% |
| `situation.priceExpectations.notes` | 2 | 1% |
| `manifest` | 2 | 1% |
| `manifest.owner` | 2 | 1% |
| `manifest.owner.phones` | 2 | 1% |
| `manifest.owner.deceased` | 2 | 1% |
| `manifest.owner.fullName` | 2 | 1% |
| `manifest.owner.lastName` | 2 | 1% |
| `manifest.owner.firstName` | 2 | 1% |
| `manifest.owner.outOfState` | 2 | 1% |
| `manifest.owner.personalityType` | 2 | 1% |
| `manifest.source` | 2 | 1% |
| `manifest.booking` | 2 | 1% |
| `manifest.booking.type` | 2 | 1% |
| `manifest.created` | 2 | 1% |
| `manifest.version` | 2 | 1% |
| `manifest.manifest` | 2 | 1% |
| `manifest.manifest.owner` | 2 | 1% |
| `manifest.manifest.owner.phones` | 2 | 1% |
| `manifest.manifest.owner.deceased` | 2 | 1% |
| `manifest.manifest.owner.fullName` | 2 | 1% |
| `manifest.manifest.owner.lastName` | 2 | 1% |
| `manifest.manifest.owner.firstName` | 2 | 1% |
| `manifest.manifest.owner.outOfState` | 2 | 1% |
| `manifest.manifest.owner.personalityType` | 2 | 1% |
| `manifest.manifest.source` | 2 | 1% |
| `manifest.manifest.booking` | 2 | 1% |
| `manifest.manifest.booking.type` | 2 | 1% |
| `manifest.manifest.created` | 2 | 1% |
| `manifest.manifest.version` | 2 | 1% |
| `manifest.manifest.manifest` | 2 | 1% |
| `manifest.manifest.manifest.owner` | 2 | 1% |
| `manifest.manifest.manifest.owner.phones` | 2 | 1% |
| `manifest.manifest.manifest.owner.deceased` | 2 | 1% |
| `manifest.manifest.manifest.owner.fullName` | 2 | 1% |
| `manifest.manifest.manifest.owner.lastName` | 2 | 1% |
| `manifest.manifest.manifest.owner.firstName` | 2 | 1% |
| `manifest.manifest.manifest.owner.outOfState` | 2 | 1% |
| `manifest.manifest.manifest.source` | 2 | 1% |
| `manifest.manifest.manifest.booking` | 2 | 1% |
| `manifest.manifest.manifest.booking.type` | 2 | 1% |
| `manifest.manifest.manifest.created` | 2 | 1% |
| `manifest.manifest.manifest.version` | 2 | 1% |
| `manifest.manifest.manifest.priority` | 2 | 1% |
| `manifest.manifest.manifest.property` | 2 | 1% |
| `manifest.manifest.manifest.property.address` | 2 | 1% |
| `manifest.manifest.manifest.property.occupancy` | 2 | 1% |
| `manifest.manifest.manifest.situation` | 2 | 1% |
| `manifest.manifest.manifest.situation.type` | 2 | 1% |
| `manifest.manifest.manifest.situation.summary` | 2 | 1% |
| `manifest.manifest.manifest.agentNotes` | 2 | 1% |
| `manifest.manifest.manifest.auditTrail` | 2 | 1% |
| `manifest.manifest.manifest.financials` | 2 | 1% |
| `manifest.manifest.manifest.manifestId` | 2 | 1% |
| `manifest.manifest.manifest.lastUpdated` | 2 | 1% |
| `manifest.manifest.manifest.lastUpdatedBy` | 2 | 1% |
| `manifest.manifest.manifest.communications` | 2 | 1% |
| `manifest.manifest.manifest.communications.transcripts` | 2 | 1% |
| `manifest.manifest.manifest.currentStation` | 2 | 1% |
| `manifest.manifest.manifest.ariIntelligence` | 2 | 1% |
| `manifest.manifest.manifest.ariIntelligence.lastBriefing` | 2 | 1% |
| `manifest.manifest.manifest.ariIntelligence.lastBriefing.strategy` | 2 | 1% |
| `manifest.manifest.manifest.ariIntelligence.lastBriefing.situation` | 2 | 1% |
| `manifest.manifest.manifest.ariIntelligence.lastBriefing.motivation` | 2 | 1% |
| `manifest.manifest.manifest.ariIntelligence.lastBriefing.generatedAt` | 2 | 1% |
| `manifest.manifest.manifest.ariIntelligence.lastBriefing.generatedFrom` | 2 | 1% |
| `manifest.manifest.manifest.ariIntelligence.briefingStale` | 2 | 1% |
| `manifest.manifest.priority` | 2 | 1% |
| `manifest.manifest.property` | 2 | 1% |
| `manifest.manifest.property.vacant` | 2 | 1% |
| `manifest.manifest.property.address` | 2 | 1% |
| `manifest.manifest.property.condition` | 2 | 1% |
| `manifest.manifest.property.condition.overall` | 2 | 1% |
| `manifest.manifest.property.occupancy` | 2 | 1% |
| `manifest.manifest.situation` | 2 | 1% |
| `manifest.manifest.situation.type` | 2 | 1% |
| `manifest.manifest.situation.summary` | 2 | 1% |
| `manifest.manifest.agentNotes` | 2 | 1% |
| `manifest.manifest.auditTrail` | 2 | 1% |
| `manifest.manifest.financials` | 2 | 1% |
| `manifest.manifest.manifestId` | 2 | 1% |
| `manifest.manifest.lastUpdated` | 2 | 1% |
| `manifest.manifest.lastUpdatedBy` | 2 | 1% |
| `manifest.manifest.communications` | 2 | 1% |
| `manifest.manifest.communications.transcripts` | 2 | 1% |
| `manifest.manifest.currentStation` | 2 | 1% |
| `manifest.manifest.ariIntelligence` | 2 | 1% |
| `manifest.manifest.ariIntelligence.lastBriefing` | 2 | 1% |
| `manifest.manifest.ariIntelligence.lastBriefing.strategy` | 2 | 1% |
| `manifest.manifest.ariIntelligence.lastBriefing.situation` | 2 | 1% |
| `manifest.manifest.ariIntelligence.lastBriefing.motivation` | 2 | 1% |
| `manifest.manifest.ariIntelligence.lastBriefing.generatedAt` | 2 | 1% |
| `manifest.manifest.ariIntelligence.lastBriefing.generatedFrom` | 2 | 1% |
| `manifest.manifest.ariIntelligence.briefingStale` | 2 | 1% |
| `manifest.manifest.ariIntelligence.sellerProfile` | 2 | 1% |
| `manifest.manifest.ariIntelligence.sellerProfile.decisionStyle` | 2 | 1% |
| `manifest.manifest.ariIntelligence.sellerProfile.personalityType` | 2 | 1% |
| `manifest.manifest.ariIntelligence.sellerProfile.emotionalDrivers` | 2 | 1% |
| `manifest.manifest.ariIntelligence.sellerProfile.communicationStyle` | 2 | 1% |
| `manifest.manifest.ariIntelligence.dealIntelligence` | 2 | 1% |
| `manifest.manifest.ariIntelligence.dealIntelligence.keyLeverage` | 2 | 1% |
| `manifest.manifest.ariIntelligence.dealIntelligence.confidenceScore` | 2 | 1% |
| `manifest.priority` | 2 | 1% |
| `manifest.property` | 2 | 1% |
| `manifest.property.vacant` | 2 | 1% |
| `manifest.property.address` | 2 | 1% |
| `manifest.property.condition` | 2 | 1% |
| `manifest.property.condition.overall` | 2 | 1% |
| `manifest.property.occupancy` | 2 | 1% |
| `manifest.situation` | 2 | 1% |
| `manifest.situation.type` | 2 | 1% |
| `manifest.situation.summary` | 2 | 1% |
| `manifest.situation.motivation` | 2 | 1% |
| `manifest.situation.motivation.score` | 2 | 1% |
| `manifest.situation.motivation.signals` | 2 | 1% |
| `manifest.agentNotes` | 2 | 1% |
| `manifest.auditTrail` | 2 | 1% |
| `manifest.financials` | 2 | 1% |
| `manifest.financials.back_taxes` | 2 | 1% |
| `manifest.manifestId` | 2 | 1% |
| `manifest.lastUpdated` | 2 | 1% |
| `manifest.lastUpdatedBy` | 2 | 1% |
| `manifest.communications` | 2 | 1% |
| `manifest.communications.transcripts` | 2 | 1% |
| `manifest.communications.responsePending` | 2 | 1% |
| `manifest.communications.totalTouchpoints` | 2 | 1% |
| `manifest.communications.lastSellerContactDate` | 2 | 1% |
| `manifest.communications.outreachAttemptsSinceLastResponse` | 2 | 1% |
| `manifest.currentStation` | 2 | 1% |
| `manifest.ariIntelligence` | 2 | 1% |
| `manifest.ariIntelligence.hotSignal` | 2 | 1% |
| `manifest.ariIntelligence.hotNextMove` | 2 | 1% |
| `manifest.ariIntelligence.lastBriefing` | 2 | 1% |
| `manifest.ariIntelligence.lastBriefing.strategy` | 2 | 1% |
| `manifest.ariIntelligence.lastBriefing.situation` | 2 | 1% |
| `manifest.ariIntelligence.lastBriefing.motivation` | 2 | 1% |
| `manifest.ariIntelligence.lastBriefing.generatedAt` | 2 | 1% |
| `manifest.ariIntelligence.lastBriefing.generatedFrom` | 2 | 1% |
| `manifest.ariIntelligence.briefingStale` | 2 | 1% |
| `manifest.ariIntelligence.sellerProfile` | 2 | 1% |
| `manifest.ariIntelligence.sellerProfile.decisionStyle` | 2 | 1% |
| `manifest.ariIntelligence.sellerProfile.personalityType` | 2 | 1% |
| `manifest.ariIntelligence.sellerProfile.emotionalDrivers` | 2 | 1% |
| `manifest.ariIntelligence.sellerProfile.communicationStyle` | 2 | 1% |
| `manifest.ariIntelligence.dealIntelligence` | 2 | 1% |
| `manifest.ariIntelligence.dealIntelligence.keyLeverage` | 2 | 1% |
| `manifest.ariIntelligence.dealIntelligence.confidenceScore` | 2 | 1% |
| `manifest.ariIntelligence.hotSignalGeneratedAt` | 2 | 1% |
| `property.propertyType` | 2 | 1% |
| `situation.urgencyFlags` | 2 | 1% |
| `financials.liens` | 2 | 1% |
| `situation.motivation.primary` | 2 | 1% |
| `assignedAgent` | 2 | 1% |
| `owner.emails` | 2 | 1% |
| `situation.timeline.constraints` | 2 | 1% |
| `situation.motivation.secondary` | 2 | 1% |
| `situation.motivation.notes` | 1 | 1% |
| `leadId` | 1 | 1% |
| `manifest.owner.relationshipToProperty` | 1 | 1% |
| `manifest.leadId` | 1 | 1% |
| `manifest.booking.location` | 1 | 1% |
| `manifest.booking.assignedAgent` | 1 | 1% |
| `manifest.manifest.owner.relationshipToProperty` | 1 | 1% |
| `manifest.manifest.leadId` | 1 | 1% |
| `manifest.manifest.booking.location` | 1 | 1% |
| `manifest.manifest.booking.assignedAgent` | 1 | 1% |
| `manifest.manifest.manifest.owner.relationshipToProperty` | 1 | 1% |
| `manifest.manifest.manifest.leadId` | 1 | 1% |
| `manifest.manifest.manifest.booking.location` | 1 | 1% |
| `manifest.manifest.manifest.booking.assignedAgent` | 1 | 1% |
| `manifest.manifest.manifest.property.zip` | 1 | 1% |
| `manifest.manifest.manifest.property.city` | 1 | 1% |
| `manifest.manifest.manifest.property.hvac` | 1 | 1% |
| `manifest.manifest.manifest.property.roof` | 1 | 1% |
| `manifest.manifest.manifest.property.state` | 1 | 1% |
| `manifest.manifest.manifest.property.garage` | 1 | 1% |
| `manifest.manifest.manifest.property.fireplace` | 1 | 1% |
| `manifest.manifest.manifest.property.propertyType` | 1 | 1% |
| `manifest.manifest.manifest.situation.painPoints` | 1 | 1% |
| `manifest.manifest.manifest.situation.urgencyFlags` | 1 | 1% |
| `manifest.manifest.manifest.situation.motivationLevel` | 1 | 1% |
| `manifest.manifest.manifest.financials.liens` | 1 | 1% |
| `manifest.manifest.manifest.financials.back_taxes` | 1 | 1% |
| `manifest.manifest.manifest.qualificationScore` | 1 | 1% |
| `manifest.manifest.property.zip` | 1 | 1% |
| `manifest.manifest.property.city` | 1 | 1% |
| `manifest.manifest.property.hvac` | 1 | 1% |
| `manifest.manifest.property.roof` | 1 | 1% |
| `manifest.manifest.property.state` | 1 | 1% |
| `manifest.manifest.property.garage` | 1 | 1% |
| `manifest.manifest.property.fireplace` | 1 | 1% |
| `manifest.manifest.property.propertyType` | 1 | 1% |
| `manifest.manifest.situation.painPoints` | 1 | 1% |
| `manifest.manifest.situation.urgencyFlags` | 1 | 1% |
| `manifest.manifest.situation.motivationLevel` | 1 | 1% |
| `manifest.manifest.financials.liens` | 1 | 1% |
| `manifest.manifest.financials.back_taxes` | 1 | 1% |
| `manifest.manifest.financials.liens_amount` | 1 | 1% |
| `manifest.manifest.qualificationScore` | 1 | 1% |
| `manifest.property.zip` | 1 | 1% |
| `manifest.property.city` | 1 | 1% |
| `manifest.property.hvac` | 1 | 1% |
| `manifest.property.roof` | 1 | 1% |
| `manifest.property.state` | 1 | 1% |
| `manifest.property.garage` | 1 | 1% |
| `manifest.property.parcel` | 1 | 1% |
| `manifest.property.dwelling` | 1 | 1% |
| `manifest.property.dwelling.sqft` | 1 | 1% |
| `manifest.property.dwelling.style` | 1 | 1% |
| `manifest.property.dwelling.bedrooms` | 1 | 1% |
| `manifest.property.dwelling.bathrooms` | 1 | 1% |
| `manifest.property.dwelling.yearBuilt` | 1 | 1% |
| `manifest.property.fireplace` | 1 | 1% |
| `manifest.property.assessment` | 1 | 1% |
| `manifest.property.assessment.totalValue` | 1 | 1% |
| `manifest.property.propertyType` | 1 | 1% |
| `manifest.property.taxCollector` | 1 | 1% |
| `manifest.property.taxCollector.status` | 1 | 1% |
| `manifest.property.taxCollector.delinquentAmount` | 1 | 1% |
| `manifest.situation.painPoints` | 1 | 1% |
| `manifest.situation.urgencyFlags` | 1 | 1% |
| `manifest.situation.motivationLevel` | 1 | 1% |
| `manifest.financials.arv` | 1 | 1% |
| `manifest.financials.liens` | 1 | 1% |
| `manifest.financials.liens_amount` | 1 | 1% |
| `manifest.financials.repair_estimate` | 1 | 1% |
| `manifest.lastCallDate` | 1 | 1% |
| `manifest.communications.lastInboundDate` | 1 | 1% |
| `manifest.communications.totalInboundContacts` | 1 | 1% |
| `manifest.communications.lastConversationCloser` | 1 | 1% |
| `manifest.communications.daysSinceLastSellerResponse` | 1 | 1% |
| `manifest.qualificationScore` | 1 | 1% |
| `property.hvac` | 1 | 1% |
| `property.roof` | 1 | 1% |
| `property.garage` | 1 | 1% |
| `property.fireplace` | 1 | 1% |
| `financials.offer_amount` | 1 | 1% |
| `financials.repair_estimate` | 1 | 1% |
| `pipeline.appointment.outcomeNotes` | 1 | 1% |
| `pipeline.appointment.reEngagement` | 1 | 1% |
| `pipeline.appointment.reEngagement.needed` | 1 | 1% |
| `pipeline.appointment.reEngagement.reason` | 1 | 1% |
| `pipeline.appointment.reEngagement.markedAt` | 1 | 1% |
| `pipeline.appointment.outcomeRecordedAt` | 1 | 1% |
| `coOwners` | 1 | 1% |
| `manifest.deal` | 1 | 1% |
| `manifest.deal.status` | 1 | 1% |
| `manifest.flags` | 1 | 1% |
| `manifest.notes` | 1 | 1% |
| `manifest.booking.confirmedAt` | 1 | 1% |
| `manifest.coOwners` | 1 | 1% |
| `manifest.contacts` | 1 | 1% |
| `manifest.manifest.deal` | 1 | 1% |
| `manifest.manifest.deal.status` | 1 | 1% |
| `manifest.manifest.flags` | 1 | 1% |
| `manifest.manifest.notes` | 1 | 1% |
| `manifest.manifest.booking.confirmedAt` | 1 | 1% |
| `manifest.manifest.coOwners` | 1 | 1% |
| `manifest.manifest.contacts` | 1 | 1% |
| `manifest.manifest.manifest.deal` | 1 | 1% |
| `manifest.manifest.manifest.deal.status` | 1 | 1% |
| `manifest.manifest.manifest.flags` | 1 | 1% |
| `manifest.manifest.manifest.notes` | 1 | 1% |
| `manifest.manifest.manifest.owner.personalityType` | 1 | 1% |
| `manifest.manifest.manifest.booking.confirmedAt` | 1 | 1% |
| `manifest.manifest.manifest.coOwners` | 1 | 1% |
| `manifest.manifest.manifest.contacts` | 1 | 1% |
| `manifest.manifest.manifest.pipeline` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.offer` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.offer.status` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.closed` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.closed.status` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.intake` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.intake.notes` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.intake.status` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.intake.completedAt` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.closing` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.closing.status` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.contract` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.contract.status` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.research` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.research.status` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.discovery` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.discovery.status` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.valuation` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.valuation.status` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.inspection` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.inspection.status` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.qualifying` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.qualifying.status` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.closing_prep` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.closing_prep.status` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.negotiations` | 1 | 1% |
| `manifest.manifest.manifest.pipeline.negotiations.status` | 1 | 1% |
| `manifest.manifest.manifest.property.vacant` | 1 | 1% |
| `manifest.manifest.manifest.property.condition` | 1 | 1% |
| `manifest.manifest.manifest.property.condition.notes` | 1 | 1% |
| `manifest.manifest.manifest.property.condition.overall` | 1 | 1% |
| `manifest.manifest.manifest.situation.blockers` | 1 | 1% |
| `manifest.manifest.manifest.situation.timeline` | 1 | 1% |
| `manifest.manifest.manifest.situation.timeline.urgency` | 1 | 1% |
| `manifest.manifest.manifest.situation.timeline.lifeEventType` | 1 | 1% |
| `manifest.manifest.manifest.situation.timeline.lifeEventStage` | 1 | 1% |
| `manifest.manifest.manifest.situation.motivation` | 1 | 1% |
| `manifest.manifest.manifest.situation.motivation.score` | 1 | 1% |
| `manifest.manifest.manifest.situation.motivation.primary` | 1 | 1% |
| `manifest.manifest.manifest.situation.motivation.signals` | 1 | 1% |
| `manifest.manifest.manifest.situation.objections` | 1 | 1% |
| `manifest.manifest.manifest.situation.priceExpectations` | 1 | 1% |
| `manifest.manifest.manifest.situation.priceExpectations.priceFlexibility` | 1 | 1% |
| `manifest.manifest.manifest.financials.seller_floor` | 1 | 1% |
| `manifest.manifest.manifest.financials.seller_asking` | 1 | 1% |
| `manifest.manifest.manifest.financials.mortgage_balance` | 1 | 1% |
| `manifest.manifest.manifest.is_favorite` | 1 | 1% |
| `manifest.manifest.manifest.assignedAgent` | 1 | 1% |
| `manifest.manifest.manifest.communications.responsePending` | 1 | 1% |
| `manifest.manifest.manifest.communications.totalTouchpoints` | 1 | 1% |
| `manifest.manifest.manifest.communications.lastSellerContactDate` | 1 | 1% |
| `manifest.manifest.manifest.communications.outreachAttemptsSinceLastResponse` | 1 | 1% |
| `manifest.manifest.manifest.ariIntelligence.hotSignal` | 1 | 1% |
| `manifest.manifest.manifest.ariIntelligence.hotNextMove` | 1 | 1% |
| `manifest.manifest.manifest.ariIntelligence.sellerProfile` | 1 | 1% |
| `manifest.manifest.manifest.ariIntelligence.sellerProfile.decisionStyle` | 1 | 1% |
| `manifest.manifest.manifest.ariIntelligence.sellerProfile.personalityType` | 1 | 1% |
| `manifest.manifest.manifest.ariIntelligence.sellerProfile.emotionalDrivers` | 1 | 1% |
| `manifest.manifest.manifest.ariIntelligence.sellerProfile.communicationStyle` | 1 | 1% |
| `manifest.manifest.manifest.ariIntelligence.dealIntelligence` | 1 | 1% |
| `manifest.manifest.manifest.ariIntelligence.dealIntelligence.keyLeverage` | 1 | 1% |
| `manifest.manifest.manifest.ariIntelligence.dealIntelligence.confidenceScore` | 1 | 1% |
| `manifest.manifest.manifest.ariIntelligence.recommendedActions` | 1 | 1% |
| `manifest.manifest.manifest.ariIntelligence.hotSignalGeneratedAt` | 1 | 1% |
| `manifest.manifest.pipeline` | 1 | 1% |
| `manifest.manifest.pipeline.offer` | 1 | 1% |
| `manifest.manifest.pipeline.offer.status` | 1 | 1% |
| `manifest.manifest.pipeline.closed` | 1 | 1% |
| `manifest.manifest.pipeline.closed.status` | 1 | 1% |
| `manifest.manifest.pipeline.intake` | 1 | 1% |
| `manifest.manifest.pipeline.intake.notes` | 1 | 1% |
| `manifest.manifest.pipeline.intake.status` | 1 | 1% |
| `manifest.manifest.pipeline.intake.completedAt` | 1 | 1% |
| `manifest.manifest.pipeline.closing` | 1 | 1% |
| `manifest.manifest.pipeline.closing.status` | 1 | 1% |
| `manifest.manifest.pipeline.contract` | 1 | 1% |
| `manifest.manifest.pipeline.contract.status` | 1 | 1% |
| `manifest.manifest.pipeline.research` | 1 | 1% |
| `manifest.manifest.pipeline.research.status` | 1 | 1% |
| `manifest.manifest.pipeline.discovery` | 1 | 1% |
| `manifest.manifest.pipeline.discovery.status` | 1 | 1% |
| `manifest.manifest.pipeline.valuation` | 1 | 1% |
| `manifest.manifest.pipeline.valuation.status` | 1 | 1% |
| `manifest.manifest.pipeline.inspection` | 1 | 1% |
| `manifest.manifest.pipeline.inspection.status` | 1 | 1% |
| `manifest.manifest.pipeline.qualifying` | 1 | 1% |
| `manifest.manifest.pipeline.qualifying.status` | 1 | 1% |
| `manifest.manifest.pipeline.closing_prep` | 1 | 1% |
| `manifest.manifest.pipeline.closing_prep.status` | 1 | 1% |
| `manifest.manifest.pipeline.negotiations` | 1 | 1% |
| `manifest.manifest.pipeline.negotiations.status` | 1 | 1% |
| `manifest.manifest.property.condition.notes` | 1 | 1% |
| `manifest.manifest.situation.blockers` | 1 | 1% |
| `manifest.manifest.situation.timeline` | 1 | 1% |
| `manifest.manifest.situation.timeline.urgency` | 1 | 1% |
| `manifest.manifest.situation.timeline.lifeEventType` | 1 | 1% |
| `manifest.manifest.situation.timeline.lifeEventStage` | 1 | 1% |
| `manifest.manifest.situation.motivation` | 1 | 1% |
| `manifest.manifest.situation.motivation.score` | 1 | 1% |
| `manifest.manifest.situation.motivation.primary` | 1 | 1% |
| `manifest.manifest.situation.motivation.signals` | 1 | 1% |
| `manifest.manifest.situation.objections` | 1 | 1% |
| `manifest.manifest.situation.priceExpectations` | 1 | 1% |
| `manifest.manifest.situation.priceExpectations.priceFlexibility` | 1 | 1% |
| `manifest.manifest.financials.seller_floor` | 1 | 1% |
| `manifest.manifest.financials.seller_asking` | 1 | 1% |
| `manifest.manifest.financials.mortgage_balance` | 1 | 1% |
| `manifest.manifest.is_favorite` | 1 | 1% |
| `manifest.manifest.assignedAgent` | 1 | 1% |
| `manifest.manifest.communications.responsePending` | 1 | 1% |
| `manifest.manifest.communications.totalTouchpoints` | 1 | 1% |
| `manifest.manifest.communications.lastSellerContactDate` | 1 | 1% |
| `manifest.manifest.communications.outreachAttemptsSinceLastResponse` | 1 | 1% |
| `manifest.manifest.ariIntelligence.hotSignal` | 1 | 1% |
| `manifest.manifest.ariIntelligence.hotNextMove` | 1 | 1% |
| `manifest.manifest.ariIntelligence.recommendedActions` | 1 | 1% |
| `manifest.manifest.ariIntelligence.hotSignalGeneratedAt` | 1 | 1% |
| `manifest.pipeline` | 1 | 1% |
| `manifest.pipeline.offer` | 1 | 1% |
| `manifest.pipeline.offer.status` | 1 | 1% |
| `manifest.pipeline.closed` | 1 | 1% |
| `manifest.pipeline.closed.status` | 1 | 1% |
| `manifest.pipeline.intake` | 1 | 1% |
| `manifest.pipeline.intake.notes` | 1 | 1% |
| `manifest.pipeline.intake.status` | 1 | 1% |
| `manifest.pipeline.intake.completedAt` | 1 | 1% |
| `manifest.pipeline.closing` | 1 | 1% |
| `manifest.pipeline.closing.status` | 1 | 1% |
| `manifest.pipeline.contract` | 1 | 1% |
| `manifest.pipeline.contract.status` | 1 | 1% |
| `manifest.pipeline.research` | 1 | 1% |
| `manifest.pipeline.research.status` | 1 | 1% |
| `manifest.pipeline.discovery` | 1 | 1% |
| `manifest.pipeline.discovery.status` | 1 | 1% |
| `manifest.pipeline.valuation` | 1 | 1% |
| `manifest.pipeline.valuation.status` | 1 | 1% |
| `manifest.pipeline.inspection` | 1 | 1% |
| `manifest.pipeline.inspection.status` | 1 | 1% |
| `manifest.pipeline.qualifying` | 1 | 1% |
| `manifest.pipeline.qualifying.status` | 1 | 1% |
| `manifest.pipeline.closing_prep` | 1 | 1% |
| `manifest.pipeline.closing_prep.status` | 1 | 1% |
| `manifest.pipeline.negotiations` | 1 | 1% |
| `manifest.pipeline.negotiations.status` | 1 | 1% |
| `manifest.property.condition.notes` | 1 | 1% |
| `manifest.situation.blockers` | 1 | 1% |
| `manifest.situation.timeline` | 1 | 1% |
| `manifest.situation.timeline.urgency` | 1 | 1% |
| `manifest.situation.timeline.lifeEventType` | 1 | 1% |
| `manifest.situation.timeline.lifeEventStage` | 1 | 1% |
| `manifest.situation.motivation.primary` | 1 | 1% |
| `manifest.situation.objections` | 1 | 1% |
| `manifest.situation.priceExpectations` | 1 | 1% |
| `manifest.situation.priceExpectations.priceFlexibility` | 1 | 1% |
| `manifest.financials.seller_floor` | 1 | 1% |
| `manifest.financials.seller_asking` | 1 | 1% |
| `manifest.financials.mortgage_balance` | 1 | 1% |
| `manifest.is_favorite` | 1 | 1% |
| `manifest.assignedAgent` | 1 | 1% |
| `manifest.ariIntelligence.recommendedActions` | 1 | 1% |
| `situation.timeline.lifeEventType` | 1 | 1% |
| `situation.timeline.lifeEventStage` | 1 | 1% |
| `financials.seller_floor` | 1 | 1% |
| `financials.seller_asking` | 1 | 1% |
| `property.county` | 1 | 1% |
| `leadSource` | 1 | 1% |
| `communications.cadenceGapDetected` | 1 | 1% |
| `owner.contactPreference` | 1 | 1% |
| `booking.notes` | 1 | 1% |
| `situation.priceExpectations.basis` | 1 | 1% |
| `situation.priceExpectations.sellerAsk` | 1 | 1% |
| `situation.priceExpectations.sellerMax` | 1 | 1% |
| `financials.sellerAsk` | 1 | 1% |
| `financials.redfin_estimate` | 1 | 1% |
| `property.type` | 1 | 1% |
| `property.acres` | 1 | 1% |
| `property.parcels` | 1 | 1% |
| `property.condition.details` | 1 | 1% |
| `situation.priceExpectations.minimum` | 1 | 1% |
| `ariIntelligence.dealIntelligence.notes` | 1 | 1% |
| `ariIntelligence.dealIntelligence.dealType` | 1 | 1% |

---

## Transform design implications

**High-confidence mappings (populated in >50% of rows):**

- `owner` (100%)
- `owner.lastName` (100%)
- `owner.firstName` (100%)
- `version` (100%)
- `priority` (100%)
- `property` (100%)
- `situation` (100%)
- `auditTrail` (100%)
- `lastUpdated` (100%)
- `lastUpdatedBy` (100%)
- `currentStation` (100%)
- `flags` (99%)
- `communications` (99%)
- `ariIntelligence` (97%)
- `ariIntelligence.briefingStale` (97%)
- `owner.deceased` (96%)
- `situation.motivation` (94%)
- `owner.fullName` (92%)
- `owner.outOfState` (92%)
- `source` (92%)
- `booking` (92%)
- `booking.type` (92%)
- `created` (92%)
- `manifestId` (92%)
- `deal` (92%)
- `deal.status` (92%)
- `pipeline` (92%)
- `pipeline.offer` (92%)
- `pipeline.offer.status` (92%)
- `pipeline.closed` (92%)
- `pipeline.closed.status` (92%)
- `pipeline.intake` (92%)
- `pipeline.intake.notes` (92%)
- `pipeline.intake.status` (92%)
- `pipeline.intake.completedAt` (92%)
- `pipeline.closing` (92%)
- `pipeline.closing.status` (92%)
- `pipeline.contract` (92%)
- `pipeline.contract.status` (92%)
- `pipeline.research` (92%)
- `pipeline.research.status` (92%)
- `pipeline.discovery` (92%)
- `pipeline.discovery.status` (92%)
- `pipeline.valuation` (92%)
- `pipeline.valuation.status` (92%)
- `pipeline.inspection` (92%)
- `pipeline.inspection.status` (92%)
- `pipeline.qualifying` (92%)
- `pipeline.qualifying.status` (92%)
- `pipeline.closing_prep` (92%)
- `pipeline.closing_prep.status` (92%)
- `pipeline.negotiations` (92%)
- `pipeline.negotiations.status` (92%)
- `situation.timeline` (92%)
- `booking.confirmedAt` (91%)
- `contacts` (91%)
- `property.address` (82%)
- `communications.transcripts` (80%)
- `owner.phones` (79%)
- `situation.motivation.score` (75%)
- `ariIntelligence.sellerProfile` (63%)
- `ariIntelligence.sellerProfile.communicationStyle` (63%)
- `owner.personalityType` (62%)
- `situation.timeline.urgency` (62%)
- `ariIntelligence.sellerProfile.personalityType` (62%)
- `ariIntelligence.sellerProfile.decisionStyle` (62%)
- `situation.type` (57%)
- `ariIntelligence.sellerProfile.emotionalDrivers` (56%)
- `ariIntelligence.dealIntelligence` (53%)
- `ariIntelligence.dealIntelligence.confidenceScore` (53%)

**Low-population paths (<5%) — transform can safely omit:**

- `flags.redFlags` (4%)
- `property.zip` (4%)
- `pipeline.qualifying.completedAt` (4%)
- `financials.arv_source` (4%)
- `situation.priceExpectations.sellerAsking` (4%)
- `property.dwelling.hvac` (3%)
- `property.dwelling.basement` (3%)
- `property.dwelling.totalRooms` (3%)
- `property.taxCollector.pastYearsDue` (3%)
- `property.taxCollector.delinquentYears` (3%)
- `property.taxCollector.currentAmountDue` (3%)
- `property.dwelling.hasFireplace` (3%)
- `property.taxCollector.status` (3%)
- `communications.lastSellerContactDate` (3%)
- `is_favorite` (3%)
- `situation.priceExpectations.sellerFloor` (3%)
- `lastTextDate` (3%)
- `communications.totalInboundContacts` (2%)
- `property.dwelling.finishedBasementSqft` (2%)
- `owner.relationshipToProperty` (2%)
- `situation.painPoints` (2%)
- `communications.lastInboundDate` (2%)
- `communications.daysSinceLastSellerResponse` (2%)
- `owner.email` (2%)
- `owner.coOwners` (2%)
- `situation.priceExpectations.notes` (1%)
- `manifest` (1%)
- `manifest.owner` (1%)
- `manifest.owner.phones` (1%)
- `manifest.owner.deceased` (1%)

**Missing entirely (0% populated) — spec assumes these but reality doesn't have them:**

Any V2.1 field referenced in the spec that doesn't appear in the list above is either:
(a) not present in current V2 data — transform must synthesize or omit, or
(b) named differently in V2 — transform needs an explicit mapping rule.

---

Generated by `scripts/migration/02_shape_analyzer.mjs`.
