import { Resolver } from 'node:dns/promises'
import { isDisposableDomain } from './disposable-domains'
import { emailDomain, emailLocalPart, syntaxValid } from './status'

const ROLE = new Set([
  'abuse',
  'accounting',
  'accounts',
  'admin',
  'administrator',
  'billing',
  'booking',
  'bookings',
  'careers',
  'compliance',
  'contact',
  'customerservice',
  'customersupport',
  'enquiry',
  'enquiries',
  'feedback',
  'ftp',
  'hello',
  'help',
  'hostmaster',
  'hr',
  'info',
  'information',
  'inquiries',
  'it-support',
  'jobs',
  'legal',
  'list',
  'listserv',
  'mailer-daemon',
  'majordomo',
  'marketing',
  'media',
  'newsletter',
  'nobody',
  'no-reply',
  'no.reply',
  'noreply',
  'notification',
  'notifications',
  'office',
  'operations',
  'ops',
  'payroll',
  'postmaster',
  'press',
  'privacy',
  'reception',
  'reservations',
  'root',
  'sales',
  'security',
  'service',
  'subscribe',
  'support',
  'sysadmin',
  'team',
  'unsubscribe',
  'uucp',
  'webmaster',
])

/** Reserved DNS names used by the local email pilot. Absence of MX is not a negative signal. */
const RESERVED_TLDS = new Set(['test', 'example', 'invalid', 'localhost'])

export type MxResult = 'present' | 'absent' | 'inconclusive'

export type LocalEmailChecks = {
  syntax: 'valid' | 'invalid'
  disposable: boolean
  role: boolean
  mx: MxResult
}

export function isRoleAddress(email: string): boolean {
  return ROLE.has(emailLocalPart(email))
}

export function localFlags(email: string, mx: MxResult): LocalEmailChecks {
  return {
    syntax: syntaxValid(email) ? 'valid' : 'invalid',
    disposable: isDisposableDomain(emailDomain(email)),
    role: isRoleAddress(email),
    mx,
  }
}

type DnsError = NodeJS.ErrnoException

function dnsCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String((error as DnsError).code) : undefined
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('dns timeout'), { code: 'ETIMEOUT' })), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export type MxResolver = (domain: string) => Promise<MxResult>

/** MX, then A/AAAA as the implicit exchanger. Timeouts stay inconclusive so a blip is not an invalid address. */
export async function lookupMailExchange(domain: string, timeoutMs = 2000): Promise<MxResult> {
  const tld = domain.split('.').pop() ?? ''
  if (RESERVED_TLDS.has(tld)) return 'inconclusive'
  const resolver = new Resolver()
  try {
    const records = await withTimeout(resolver.resolveMx(domain), timeoutMs)
    if (records.some((record) => record.exchange)) return 'present'
  } catch (error) {
    const code = dnsCode(error)
    if (code !== 'ENODATA' && code !== 'ENOTFOUND') return 'inconclusive'
  }
  try {
    const [ipv4, ipv6] = await Promise.allSettled([
      withTimeout(resolver.resolve4(domain), timeoutMs),
      withTimeout(resolver.resolve6(domain), timeoutMs),
    ])
    const hasAddress = (result: PromiseSettledResult<string[]>) => result.status === 'fulfilled' && result.value.length > 0
    if (hasAddress(ipv4) || hasAddress(ipv6)) return 'present'
    const codes = [ipv4, ipv6].map((result) => result.status === 'rejected' ? dnsCode(result.reason) : 'OK')
    if (codes.every((code) => code === 'ENOTFOUND' || code === 'ENODATA')) return 'absent'
    return 'inconclusive'
  } catch {
    return 'inconclusive'
  }
}
