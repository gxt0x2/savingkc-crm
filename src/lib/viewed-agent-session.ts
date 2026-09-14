export const VIEWED_AGENT_STORAGE_KEY = 'savingkc:viewed-agent-email'
export const VIEWED_AGENT_CHANGE_EVENT = 'savingkc:viewed-agent-change'
const VIEWED_AGENT_STORAGE_VERSION = 'v2'
const VIEWED_AGENT_ACTOR_STORAGE_KEY = `${VIEWED_AGENT_STORAGE_KEY}:actor`

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ''
}

export function viewedAgentStorageKey(authenticatedEmail: string): string {
  return `${VIEWED_AGENT_STORAGE_KEY}:${VIEWED_AGENT_STORAGE_VERSION}:${normalizeEmail(authenticatedEmail)}`
}

export function readViewedAgentEmail(fallbackEmail: string | null | undefined): string {
  const authenticatedEmail = normalizeEmail(fallbackEmail)
  if (typeof window === 'undefined') return authenticatedEmail
  if (!authenticatedEmail) return ''

  try {
    const persistedEmail = window.localStorage.getItem(viewedAgentStorageKey(authenticatedEmail))
    const sessionActorEmail = normalizeEmail(
      window.sessionStorage.getItem(VIEWED_AGENT_ACTOR_STORAGE_KEY),
    )
    const sessionViewedEmail = !sessionActorEmail || sessionActorEmail === authenticatedEmail
      ? window.sessionStorage.getItem(VIEWED_AGENT_STORAGE_KEY)
      : null
    // Keep reading the old tab-scoped value so an already-open workspace does
    // not change identity when this cross-tab persistence ships.
    return normalizeEmail(
      persistedEmail
      || sessionViewedEmail
      || authenticatedEmail,
    )
  } catch {
    return authenticatedEmail
  }
}

export function getViewedAgentEmailSnapshot(authenticatedEmail?: string | null): string {
  return readViewedAgentEmail(authenticatedEmail)
}

export function getServerViewedAgentEmailSnapshot(authenticatedEmail?: string | null): string {
  return normalizeEmail(authenticatedEmail)
}

export function subscribeToViewedAgentChange(onStoreChange: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key?.startsWith(`${VIEWED_AGENT_STORAGE_KEY}:${VIEWED_AGENT_STORAGE_VERSION}:`)) onStoreChange()
  }

  window.addEventListener(VIEWED_AGENT_CHANGE_EVENT, onStoreChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(VIEWED_AGENT_CHANGE_EVENT, onStoreChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function setViewedAgentEmail(email: string, authenticatedEmail: string): void {
  if (typeof window === 'undefined') return
  const viewedEmail = normalizeEmail(email)
  const actorEmail = normalizeEmail(authenticatedEmail)

  try {
    window.sessionStorage.setItem(VIEWED_AGENT_ACTOR_STORAGE_KEY, actorEmail)
    window.sessionStorage.setItem(VIEWED_AGENT_STORAGE_KEY, viewedEmail)
    if (actorEmail) {
      window.localStorage.setItem(viewedAgentStorageKey(actorEmail), viewedEmail)
    }
  } catch {}
  window.dispatchEvent(new CustomEvent<string>(VIEWED_AGENT_CHANGE_EVENT, { detail: viewedEmail }))
}
