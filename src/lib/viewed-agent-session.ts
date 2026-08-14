export const VIEWED_AGENT_STORAGE_KEY = 'savingkc:viewed-agent-email'
export const VIEWED_AGENT_CHANGE_EVENT = 'savingkc:viewed-agent-change'

export function readViewedAgentEmail(fallbackEmail: string | null | undefined): string {
  if (typeof window === 'undefined') return fallbackEmail ?? ''
  return window.sessionStorage.getItem(VIEWED_AGENT_STORAGE_KEY) || fallbackEmail || ''
}

export function getViewedAgentEmailSnapshot(): string {
  return readViewedAgentEmail('')
}

export function getServerViewedAgentEmailSnapshot(): string {
  return ''
}

export function subscribeToViewedAgentChange(onStoreChange: () => void): () => void {
  window.addEventListener(VIEWED_AGENT_CHANGE_EVENT, onStoreChange)
  return () => window.removeEventListener(VIEWED_AGENT_CHANGE_EVENT, onStoreChange)
}

export function setViewedAgentEmail(email: string): void {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(VIEWED_AGENT_STORAGE_KEY, email)
  window.dispatchEvent(new CustomEvent<string>(VIEWED_AGENT_CHANGE_EVENT, { detail: email }))
}
