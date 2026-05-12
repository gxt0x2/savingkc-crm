import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`
  }
  return `$${amount.toFixed(0)}`
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(num)
}

export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

export function getContactInitials(contact: { first_name: string; last_name: string }): string {
  return getInitials(contact.first_name, contact.last_name)
}

export function getContactFullName(contact: { first_name: string; last_name: string }): string {
  return `${contact.first_name} ${contact.last_name}`
}

export function personalityColor(type: string | null): string {
  switch (type) {
    case 'assertive': return 'bg-primary text-white'
    case 'analytical': return 'bg-surface-container-high text-on-surface-variant'
    case 'amiable': return 'bg-surface-container-high text-on-surface-variant'
    case 'accommodator': return 'bg-surface-container-high text-on-surface-variant'
    case 'expressive': return 'bg-primary text-white'
    default: return 'bg-surface-container-high text-on-surface-variant'
  }
}

export function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    new: 'New',
    not_contacted: 'Not Contacted',
    contacted: 'Contacted',
    qualifying: 'Qualifying',
    qualified: 'Qualified',
    appt_set: 'Appt Set',
    appointment_set: 'Appointment Set',
    negotiations: 'Negotiations',
    offer_made: 'Offer Made',
    contract_signed: 'Contract Signed',
    under_contract: 'Under Contract',
    closed_won: 'Closed Won',
    closed_lost: 'Closed Lost',
  }
  return labels[stage] || stage
}
