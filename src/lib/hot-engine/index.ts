// Hot Opportunities Engine — barrel export
export { scoreOpportunity, type HotScoreResult, type ScoreFactors } from './scoring'
export {
  surgicalRescore,
  fullRerank,
  getHotList,
  getAcquisitionQueue,
  getInClosingList,
  getParkedList,
  parkLead,
  unparkLead,
  revivePastDueParkedLeads,
} from './cache'
export { classifyManifestChange, processHotEngineEvent, type HotEngineEvent } from './event-bus'
export { generateHotSignal, isSignalStale } from './ari-signal'
