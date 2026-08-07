import registryJson from '@/config/system-registry.json'

export type RegistryStatus = 'active' | 'experimental' | 'deprecated'

export interface RegistryCron {
  path: string
  schedule: string
  highFrequencyReason?: string
}

export interface SystemFeature {
  id: string
  name: string
  owner: string
  status: RegistryStatus
  routes: string[]
  apiRoutes: string[]
  tables: string[]
  environment: string[]
  crons?: RegistryCron[]
  retirement?: {
    reason: string
    targetDate: string
  }
}

export interface SystemRegistry {
  schemaVersion: number
  policies: {
    newFileMaxLines: number
    oversizedExistingGrowthToleranceLines: number
    approvedPolling: Array<{
      path: string
      minimumIntervalMs: number
      reason: string
    }>
  }
  features: SystemFeature[]
}

export const systemRegistry = registryJson as SystemRegistry

export function getRegisteredCrons(): Array<RegistryCron & { featureId: string; owner: string }> {
  return systemRegistry.features.flatMap((feature) =>
    (feature.crons ?? []).map((cron) => ({ ...cron, featureId: feature.id, owner: feature.owner })),
  )
}

export function getRegisteredEnvironmentVariables(): Set<string> {
  return new Set(systemRegistry.features.flatMap((feature) => feature.environment))
}

export function getRegisteredTables(): Set<string> {
  return new Set(systemRegistry.features.flatMap((feature) => feature.tables))
}
