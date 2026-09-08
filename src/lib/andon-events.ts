export const OPEN_SYSTEM_ANDON_EVENT = 'savingkc:open-system-andon'

export type OpenSystemAndonDetail = {
  defaultSection?: string
  description?: string
}

export function openSystemAndon(detail: OpenSystemAndonDetail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<OpenSystemAndonDetail>(OPEN_SYSTEM_ANDON_EVENT, { detail }))
}
