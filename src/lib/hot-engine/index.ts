// Hot Opportunities Engine — barrel export
export { scoreOpportunity, type HotScoreResult, type ScoreFactors } from './scoring'
export { surgicalRescore, fullRerank, getHotList } from './cache'
export { classifyManifestChange, processHotEngineEvent, type HotEngineEvent } from './event-bus'
export { generateHotSignal, isSignalStale } from './ari-signal'
