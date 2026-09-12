import { getDomain } from 'tldts'
export function assertIndependentSendingDomain(candidate: string, primary: string) {
 const c=candidate.trim().toLowerCase(), p=primary.trim().toLowerCase(); const cr=getDomain(c), pr=getDomain(p)
 if (!cr || !pr || c===p || c.endsWith(`.${p}`) || cr===pr) throw new Error('PRIMARY_DOMAIN_OR_SUBDOMAIN_FORBIDDEN')
 return c
}
export function senderCanStartNewEnrollment(state: 'draft'|'active'|'paused'|'retired') { return state === 'active' }
export function senderCanReceive(state: 'draft'|'active'|'paused'|'retired') { return state !== 'draft' }
