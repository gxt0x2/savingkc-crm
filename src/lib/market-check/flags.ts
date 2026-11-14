/** Explicit env only. An unset variable does not overwrite the config table. */

export function explicitEnvFlag(name: string): boolean | null {
  const value = process.env[name]
  if (value == null || value.trim() === '') return null
  return value.trim().toLowerCase() === 'true'
}

export function mlsMarketCheckEnabled(): boolean {
  return explicitEnvFlag('MLS_MARKET_CHECK_ENABLED') === true
}

export function expiredOwnerConfirmed(): boolean {
  return explicitEnvFlag('EXPIRED_OWNER_CONFIRMED') === true
}
