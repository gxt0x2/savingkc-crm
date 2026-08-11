'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { CONVERSATION_TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { formatPhone, toProperCase } from '@/lib/format'

type HubView = 'dashboard' | 'inbox' | 'campaigns' | 'templates'
type HubFilter = 'unread' | 'needs_reply' | 'unanswered' | 'reminders' | 'no_status' | 'hot' | 'drip_ready' | 'unassigned' | 'recents' | 'all'
type ComposeMode = 'sms' | 'email'
type CampaignListKey =
  | 'all_prospecting'
  | 'heir_prospecting'
  | 'pre_auction_delinquent'
  | 'excess_proceeds'
  | 'general_two_year_delinquent'
  | 'three_plus_delinquent'
type CampaignStatusFilter = HubFilter | 'ready'
type TemplateCategory =
  | 'prospecting_intro'
  | 'list_pre_auction_delinquent'
  | 'list_excess_proceeds'
  | 'list_general_two_year_delinquent'
  | 'list_three_year_delinquent'
  | 'prospecting_reply'
  | 'prospecting_follow_up'
  | 'prospecting_wrong_number'
  | 'prospecting_opt_out'
type PhoneQualityStatus = 'unknown' | 'verified' | 'wrong_number' | 'dnc' | 'spam' | 'blocked'
type ThreadWorkflowAction = 'mark_read' | 'mark_unread' | 'reminder_created' | 'reminder_completed' | 'tag_added' | 'tag_removed'

interface HubLead {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  source: string | null
  station: string | null
  priority: string | null
  assigned_agent: string | null
  notes: string | null
  created_at: string
  updated_at: string | null
}

interface HubActivity {
  id: string
  lead_id: string | null
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface ProspectPhoneContext {
  id: string | null
  phone: string | null
  contact_name: string | null
  relationship: string | null
  lead_id: string | null
  owner_1: string | null
  is_deceased: boolean | null
  delinquent_years_category: string | null
}

interface ProspectPhoneRow {
  id: string | null
  phone: string | null
  contact_name: string | null
  relationship: string | null
  prospects: {
    lead_id: string | null
    owner_1: string | null
    is_deceased: boolean | null
    delinquent_years_category: string | null
  } | Array<{
    lead_id: string | null
    owner_1: string | null
    is_deceased: boolean | null
    delinquent_years_category: string | null
  }> | null
}

interface HubThread {
  id: string
  lead: HubLead | null
  prospectPhone: ProspectPhoneContext | null
  phone: string | null
  name: string
  initials: string
  lastActivity: HubActivity | null
  unread: boolean
  starred: boolean
  activities: HubActivity[]
}

interface ThreadReminderState {
  active: boolean
  dueAt: string | null
  note: string | null
}

interface ConversationTagOption {
  id: string
  label: string
  color: string
}

interface ThreadRowSignal {
  id: string
  label: string
  icon: string
  active: boolean
  color: string
}

interface SmsTemplateRow {
  id: string
  name: string
  category: string
  body: string
  merge_fields: string[] | null
  usage_count: number | null
}

interface CampaignMetric {
  label: string
  sent: number
  replies: number
  active: number
}

interface TagMetric {
  label: string
  count: number
  tone: string
}

interface ReplyMetric {
  count: number
  averageMinutes: number | null
}

interface SmsSegmentMetric {
  encoding: 'GSM' | 'Unicode'
  characters: number
  segments: number
  remaining: number
}

interface CampaignDraft {
  name: string
  listKey: CampaignListKey
  market: string
  callForwardingNumber: string
  templateCategory: TemplateCategory
  dailyCap: number
  statusFilter: CampaignStatusFilter
  startWindow: string
  stopWindow: string
}

interface CampaignTrackerRow {
  id: CampaignListKey
  label: string
  description: string
  templateCategory: TemplateCategory
  audience: number
  sent: number
  replies: number
  needsReply: number
  unanswered: number
  dripReady: number
  suppressed: number
  responseRate: number
  lastTouchAt: string | null
  status: string
}

interface CampaignDraftMetrics {
  audience: number
  sent: number
  replies: number
  needsReply: number
  unanswered: number
  dripReady: number
  suppressed: number
  responseRate: number
  batches: number
}

const PROSPECTING_ACTIVITY_TYPES = ['sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound', 'email', 'call', 'voicemail', 'note', 'status_change', 'task', 'appointment']
const SMS_TYPES = new Set(['sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound'])
const CONVERSATION_TYPES = new Set(['sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound', 'email', 'call', 'voicemail'])
const PROSPECTING_ACTIVITY_SOURCES = new Set([
  'heir_dialer',
  'prospect_sms_alert',
  'tax_delinquent_inbound_sms',
  'tax_delinquent_inbound_call',
])
const DEFAULT_FROM_PHONE = CONVERSATION_TWILIO_NUMBERS[0]?.value || '+18163077835'
const RESTRICTED_WORDS = ['guaranteed', 'free cash', 'risk-free', 'urgent', 'act now', 'limited time', 'government', 'irs']
const NEGATIVE_KEYWORDS = [
  'lawsuit',
  'foreclosure rescue',
  'loan modification',
  'credit repair',
  'covid',
  'bankruptcy attorney',
  'sell',
  'selling',
  'buyer',
  'buying',
  'cash',
  'offer',
  'offers',
  'sorry',
  'apologies',
  'apologize',
  'we buy houses',
  'your house',
  'your home',
  'are you the owner',
  'is this the owner',
  'do you own',
]
const DEFAULT_TEMPLATE_BODY = '{firstName}, this is {agentName} with {companyName}. I had a note tied to {propertyAddress}. Are you the right person to speak with? Reply STOP to opt out.'
const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'prospecting_intro',
  'list_pre_auction_delinquent',
  'list_excess_proceeds',
  'list_general_two_year_delinquent',
  'list_three_year_delinquent',
  'prospecting_reply',
  'prospecting_follow_up',
  'prospecting_wrong_number',
  'prospecting_opt_out',
]
const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  prospecting_intro: 'Initial prospecting',
  list_pre_auction_delinquent: 'Pre-Auction Delinquent',
  list_excess_proceeds: 'Excess Proceeds',
  list_general_two_year_delinquent: 'General 2 Yr Delinquent',
  list_three_year_delinquent: '3+ Yr Delinquent',
  prospecting_reply: 'Seller reply',
  prospecting_follow_up: 'Follow-up',
  prospecting_wrong_number: 'Wrong number',
  prospecting_opt_out: 'Opt-out',
}
const TEMPLATE_CATEGORY_HINTS: Record<TemplateCategory, string> = {
  prospecting_intro: 'Heir or owner first-touch scripts for general prospecting.',
  list_pre_auction_delinquent: 'Messages for properties approaching tax sale or auction deadlines.',
  list_excess_proceeds: 'Messages for surplus/excess-proceeds outreach after a sale event.',
  list_general_two_year_delinquent: 'Messages for standard 2-year delinquent tax outreach.',
  list_three_year_delinquent: 'Messages for older delinquent lists that need a softer tone.',
  prospecting_reply: 'Replies after a prospect answers the first message.',
  prospecting_follow_up: 'Manual follow-ups after silence or incomplete conversations.',
  prospecting_wrong_number: 'Cleanup language when the recipient is not connected.',
  prospecting_opt_out: 'Compliance-safe confirmation after a stop request.',
}
const CAMPAIGN_LIST_OPTIONS: Array<{
  id: CampaignListKey
  label: string
  description: string
  templateCategory: TemplateCategory
  preset: string
}> = [
  {
    id: 'all_prospecting',
    label: 'All Prospecting',
    description: 'All loaded prospecting conversations and seller outreach activity.',
    templateCategory: 'prospecting_intro',
    preset: 'custom',
  },
  {
    id: 'heir_prospecting',
    label: 'Heir Prospecting',
    description: 'Heir, estate, deceased-owner, and related tax-prospect conversations.',
    templateCategory: 'prospecting_intro',
    preset: 'deceased_3yr',
  },
  {
    id: 'pre_auction_delinquent',
    label: 'Pre-Auction Delinquent',
    description: 'Tax-sale or auction deadline outreach with deadline-sensitive scripts.',
    templateCategory: 'list_pre_auction_delinquent',
    preset: 'tax_2yr',
  },
  {
    id: 'excess_proceeds',
    label: 'Excess Proceeds',
    description: 'Surplus, overage, and excess-proceeds review conversations.',
    templateCategory: 'list_excess_proceeds',
    preset: 'custom',
  },
  {
    id: 'general_two_year_delinquent',
    label: 'General 2 Yr Delinquent',
    description: 'Standard two-year delinquent tax prospecting list.',
    templateCategory: 'list_general_two_year_delinquent',
    preset: 'tax_2yr',
  },
  {
    id: 'three_plus_delinquent',
    label: '3+ Yr Delinquent',
    description: 'Older delinquent-tax list requiring softer follow-up language.',
    templateCategory: 'list_three_year_delinquent',
    preset: 'deceased_3yr',
  },
]
const CAMPAIGN_MARKETS = ['Kansas City', 'Johnson County', 'Jackson County', 'Clay County', 'Wyandotte County']
const INBOX_FILTER_HELP: Record<HubFilter, string> = {
  unread: 'Unread prospect messages that need real-time review.',
  needs_reply: 'Latest conversation touch is inbound from the prospect, with no newer agent response.',
  unanswered: 'Latest SMS attempt is outbound, and no newer inbound reply has arrived.',
  reminders: 'Follow-up reminders and drip-ready conversations that should be reviewed today.',
  no_status: 'Prospects that have not been given a meaningful lead status yet.',
  hot: 'High-priority or starred prospecting conversations.',
  drip_ready: 'Outbound SMS is unanswered for 3+ days and ready for another touch.',
  unassigned: 'Prospecting conversations without an assigned agent.',
  recents: 'Most recent prospecting calls, texts, and emails.',
  all: 'Every prospecting conversation loaded into this hub.',
}
const CAMPAIGN_STATUS_OPTIONS: Array<{ id: CampaignStatusFilter; label: string; detail: string }> = [
  { id: 'ready', label: 'Ready to send', detail: 'Not suppressed, no waiting seller reply, and ready for the next touch.' },
  { id: 'unread', label: 'Unread', detail: INBOX_FILTER_HELP.unread },
  { id: 'needs_reply', label: 'Needs reply', detail: INBOX_FILTER_HELP.needs_reply },
  { id: 'unanswered', label: 'Unanswered', detail: INBOX_FILTER_HELP.unanswered },
  { id: 'reminders', label: 'Reminders', detail: INBOX_FILTER_HELP.reminders },
  { id: 'no_status', label: 'No Status', detail: INBOX_FILTER_HELP.no_status },
  { id: 'drip_ready', label: 'Drip ready', detail: INBOX_FILTER_HELP.drip_ready },
  { id: 'hot', label: 'Hot', detail: INBOX_FILTER_HELP.hot },
  { id: 'unassigned', label: 'Unassigned', detail: INBOX_FILTER_HELP.unassigned },
  { id: 'all', label: 'All matching', detail: 'All conversations that match this campaign list.' },
]
const QUICK_REPLIES = [
  { label: 'Right person?', body: 'Thanks for getting back to me, {firstName}. Are you the right person to speak with about {propertyAddress}, or should I update our notes?' },
  { label: 'Can call', body: 'I can help with that. Is this the best number to call, or is there a better time today?' },
  { label: 'Need context', body: 'Thanks for letting me know. I was reaching out about {propertyAddress}. Are you connected to that property?' },
  { label: 'Wrong person', body: 'Understood. I will update our notes so we do not keep reaching out about this property.' },
  { label: 'Opt-out', body: 'Understood. I will stop texting this number.' },
]
const PROSPECTING_TEMPLATE_CATEGORY_SET = new Set<string>(TEMPLATE_CATEGORIES)
const PROSPECTING_TEMPLATE_SEEDS: SmsTemplateRow[] = [
  {
    id: 'prospecting-seed-initial-heir-outreach',
    name: 'initial_heir_outreach',
    category: 'prospecting_intro',
    body: DEFAULT_TEMPLATE_BODY,
    merge_fields: ['firstName', 'agentName', 'companyName', 'propertyAddress'],
    usage_count: 0,
  },
  {
    id: 'prospecting-seed-right-person',
    name: 'heir_right_person',
    category: 'prospecting_reply',
    body: 'Thanks for getting back to me, {firstName}. Are you the right person to speak with about {propertyAddress}, or should I update our notes?',
    merge_fields: ['firstName', 'propertyAddress'],
    usage_count: 0,
  },
  {
    id: 'prospecting-seed-pre-auction-delinquent',
    name: 'pre_auction_delinquent_intro',
    category: 'list_pre_auction_delinquent',
    body: '{firstName}, this is {agentName} with {companyName}. I had a note tied to {propertyAddress} from the upcoming tax-sale list. Are you the right person to speak with? Reply STOP to opt out.',
    merge_fields: ['firstName', 'agentName', 'companyName', 'propertyAddress'],
    usage_count: 0,
  },
  {
    id: 'prospecting-seed-pre-auction-follow-up',
    name: 'pre_auction_delinquent_follow_up',
    category: 'list_pre_auction_delinquent',
    body: '{firstName}, following up on my note about {propertyAddress}. If someone else handles this property, I can update our records. Reply STOP to opt out.',
    merge_fields: ['firstName', 'propertyAddress'],
    usage_count: 0,
  },
  {
    id: 'prospecting-seed-excess-proceeds-intro',
    name: 'excess_proceeds_review',
    category: 'list_excess_proceeds',
    body: '{firstName}, this is {agentName} with {companyName}. I had a note connected to {propertyAddress} from an excess-proceeds review. Are you the best contact for that file? Reply STOP to opt out.',
    merge_fields: ['firstName', 'agentName', 'companyName', 'propertyAddress'],
    usage_count: 0,
  },
  {
    id: 'prospecting-seed-two-year-delinquent',
    name: 'general_2_yr_delinquent_intro',
    category: 'list_general_two_year_delinquent',
    body: '{firstName}, this is {agentName} with {companyName}. I was reviewing 2-year delinquent records and had a note tied to {propertyAddress}. Are you the right contact? Reply STOP to opt out.',
    merge_fields: ['firstName', 'agentName', 'companyName', 'propertyAddress'],
    usage_count: 0,
  },
  {
    id: 'prospecting-seed-three-year-delinquent',
    name: 'three_plus_year_delinquent_intro',
    category: 'list_three_year_delinquent',
    body: '{firstName}, this is {agentName} with {companyName}. I had a note tied to {propertyAddress} from an older delinquent-tax list. Is this something you still handle? Reply STOP to opt out.',
    merge_fields: ['firstName', 'agentName', 'companyName', 'propertyAddress'],
    usage_count: 0,
  },
  {
    id: 'prospecting-seed-three-year-soft-follow-up',
    name: 'three_plus_year_delinquent_follow_up',
    category: 'list_three_year_delinquent',
    body: '{firstName}, checking back on {propertyAddress}. If this is no longer connected to you, I can clean up our notes. Reply STOP to opt out.',
    merge_fields: ['firstName', 'propertyAddress'],
    usage_count: 0,
  },
  {
    id: 'prospecting-seed-connected',
    name: 'confirm_property_connection',
    category: 'prospecting_reply',
    body: 'I was reaching out about {propertyAddress}. Are you connected to that property, or did we reach the wrong person?',
    merge_fields: ['propertyAddress'],
    usage_count: 0,
  },
  {
    id: 'prospecting-seed-call-window',
    name: 'ask_best_call_time',
    category: 'prospecting_reply',
    body: 'Got it. Is this the best number to call, or is there a better time today for a quick conversation?',
    merge_fields: [],
    usage_count: 0,
  },
  {
    id: 'prospecting-seed-soft-follow-up',
    name: 'soft_follow_up',
    category: 'prospecting_follow_up',
    body: '{firstName}, checking back on {propertyAddress}. If you are not the right person, I can update our notes. Reply STOP to opt out.',
    merge_fields: ['firstName', 'propertyAddress'],
    usage_count: 0,
  },
  {
    id: 'prospecting-seed-wrong-number',
    name: 'wrong_number_cleanup',
    category: 'prospecting_wrong_number',
    body: 'Understood. I will update our records so we do not keep reaching out about this property.',
    merge_fields: [],
    usage_count: 0,
  },
  {
    id: 'prospecting-seed-opt-out',
    name: 'opt_out_acknowledgement',
    category: 'prospecting_opt_out',
    body: 'Understood. I will stop texting this number.',
    merge_fields: [],
    usage_count: 0,
  },
]
const STAGE_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Opportunity' },
  { value: 'appointment_set', label: 'Appointment Set' },
  { value: 'offer_made', label: 'Offer Made' },
  { value: 'under_contract', label: 'Under Contract' },
  { value: 'closed_lost', label: 'Closed Lost' },
]
const PRIORITY_OPTIONS = [
  { value: 'hot', label: 'Hot' },
  { value: 'high', label: 'Warm' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Cold' },
]
const SUPPRESSED_PHONE_STATUSES = new Set<PhoneQualityStatus>(['wrong_number', 'dnc', 'spam', 'blocked'])
const THREAD_WORKFLOW_ACTIONS = new Set<ThreadWorkflowAction>(['mark_read', 'mark_unread', 'reminder_created', 'reminder_completed', 'tag_added', 'tag_removed'])
const DEFAULT_CONVERSATION_TAGS: ConversationTagOption[] = [
  { id: 'call_scheduled', label: 'Call Scheduled', color: '#42A5F5' },
  { id: 'voicemail', label: 'Voicemail', color: '#F7B955' },
  { id: 'too_high', label: 'Too High', color: '#7D9BFF' },
  { id: 'buyer', label: 'Buyer', color: '#8D7DFF' },
  { id: 'sold', label: 'Sold', color: '#B8C2CC' },
  { id: 'closed_deal', label: 'Closed Deal', color: '#EF4D6D' },
  { id: 'under_contract', label: 'Under Contract', color: '#F7B955' },
  { id: 'realtor_referral', label: 'Realtor Referral', color: '#72D398' },
  { id: 'appointment_made', label: 'Appointment Made', color: '#26C6DA' },
]
const TAG_COLOR_FALLBACKS = ['#42A5F5', '#F7B955', '#72D398', '#EF4D6D', '#8D7DFF', '#B8C2CC']
const DEFAULT_CONVERSATION_TAG_MAP = new Map(DEFAULT_CONVERSATION_TAGS.map((tag) => [tag.id, tag]))
const PHONE_STATUS_LABELS: Record<PhoneQualityStatus, string> = {
  unknown: 'unknown',
  verified: 'verified',
  wrong_number: 'wrong number',
  dnc: 'DNC',
  spam: 'spam',
  blocked: 'blocked',
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeTagId(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function conversationTagLabel(tagId: string): string {
  return DEFAULT_CONVERSATION_TAG_MAP.get(tagId)?.label || templateDisplayName(tagId)
}

function conversationTagCompactLabel(tagId: string): string {
  const compactLabels: Record<string, string> = {
    appointment_made: 'Appt Made',
    call_scheduled: 'CallSched',
    closed_deal: 'Closed',
    realtor_referral: 'Realtor',
    under_contract: 'Contract',
  }
  return compactLabels[tagId] || conversationTagLabel(tagId)
}

function conversationTagColor(tagId: string, index = 0): string {
  return DEFAULT_CONVERSATION_TAG_MAP.get(tagId)?.color || TAG_COLOR_FALLBACKS[index % TAG_COLOR_FALLBACKS.length]
}

function conversationTagOption(tagId: string, index = 0): ConversationTagOption {
  const normalized = normalizeTagId(tagId)
  return DEFAULT_CONVERSATION_TAG_MAP.get(normalized) || {
    id: normalized,
    label: conversationTagLabel(normalized),
    color: conversationTagColor(normalized, index),
  }
}

function activityMetadata(activity: HubActivity): Record<string, unknown> {
  return activity.metadata || {}
}

function activityDirection(activity: HubActivity): 'inbound' | 'outbound' {
  const direction = textValue(activityMetadata(activity).direction)?.toLowerCase()
  if (direction === 'inbound' || direction === 'received' || direction === 'in') return 'inbound'
  if (activity.activity_type === 'sms_received' || activity.activity_type === 'sms_inbound') return 'inbound'
  return 'outbound'
}

function isSmsActivity(activity: HubActivity): boolean {
  return SMS_TYPES.has(activity.activity_type)
}

function isConversationActivity(activity: HubActivity): boolean {
  return CONVERSATION_TYPES.has(activity.activity_type)
}

function activityBody(activity: HubActivity): string {
  const meta = activityMetadata(activity)
  return textValue(meta.body) || textValue(meta.message) || activity.description || ''
}

function phoneKey(value: string | null | undefined): string {
  const digits = (value || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

function activityPhone(activity: HubActivity, fallback: string | null): string | null {
  const meta = activityMetadata(activity)
  const statusPhone = textValue(meta.phone)
  if (statusPhone) return statusPhone
  if (activityDirection(activity) === 'inbound') return textValue(meta.from) || textValue(meta.to) || fallback
  return textValue(meta.to) || textValue(meta.from) || fallback
}

function activityLinePhone(activity: HubActivity): string | null {
  const meta = activityMetadata(activity)
  if (activityDirection(activity) === 'inbound') return textValue(meta.to)
  return textValue(meta.from)
}

function activitySmsRouteLabel(activity: HubActivity, fallbackPhone: string | null): string {
  const meta = activityMetadata(activity)
  const direction = activityDirection(activity)
  const from = textValue(meta.from)
  const to = textValue(meta.to)
  const contactPhone = activityPhone(activity, fallbackPhone)
  const linePhone = activityLinePhone(activity)
  const formattedFrom = formatPhone(from || '') || (from ? from : null)
  const formattedTo = formatPhone(to || '') || (to ? to : null)

  if (formattedFrom || formattedTo) {
    return `${direction === 'inbound' ? 'In' : 'Out'}: ${formattedFrom || 'Unknown'} -> ${formattedTo || 'Unknown'}`
  }

  if (linePhone && contactPhone) {
    const formattedLine = formatPhone(linePhone) || linePhone
    const formattedContact = formatPhone(contactPhone) || contactPhone
    return direction === 'inbound'
      ? `In: ${formattedContact} -> ${formattedLine}`
      : `Out: ${formattedLine} -> ${formattedContact}`
  }

  if (linePhone) return `Line: ${formatPhone(linePhone) || linePhone}`
  if (contactPhone) return `Contact: ${formatPhone(contactPhone) || contactPhone}`
  return 'Phone line unknown'
}

function activitySmsFooterPhone(activity: HubActivity, fallbackPhone: string | null): string {
  const direction = activityDirection(activity)
  const phone = direction === 'inbound'
    ? activityPhone(activity, fallbackPhone)
    : activityLinePhone(activity) || activityPhone(activity, fallbackPhone)
  return formatPhone(phone || '') || phone || 'Unknown number'
}

function smsLineCandidates(thread: HubThread | null, activeActivities: HubActivity[]): HubActivity[] {
  const byId = new Map<string, HubActivity>()
  for (const activity of thread?.activities || []) {
    if (isSmsActivity(activity)) byId.set(activity.id, activity)
  }
  for (const activity of activeActivities) {
    if (isSmsActivity(activity) && activityMatchesThread(activity, thread)) byId.set(activity.id, activity)
  }
  return sortedAscending(Array.from(byId.values()))
}

function activityMatchesThread(activity: HubActivity, thread: HubThread | null): boolean {
  if (!thread) return false
  const threadLeadId = thread.lead?.id || thread.prospectPhone?.lead_id || null
  const threadPhoneKey = phoneKey(thread.phone || thread.prospectPhone?.phone || thread.lead?.phone || null)
  const activityPhoneKey = phoneKey(activityPhone(activity, null))

  if (threadPhoneKey && activityPhoneKey) return threadPhoneKey === activityPhoneKey
  return Boolean(threadLeadId && activity.lead_id === threadLeadId)
}

function preferredReplyLineActivity(thread: HubThread | null, activeActivities: HubActivity[]): HubActivity | null {
  const candidates = smsLineCandidates(thread, activeActivities)
  const latestInbound = candidates.slice().reverse().find((activity) => (
    activityDirection(activity) === 'inbound' &&
    activityLinePhone(activity)
  ))
  if (latestInbound) return latestInbound

  return candidates.slice().reverse().find((activity) => activityLinePhone(activity)) || null
}

function preferredReplyLine(thread: HubThread | null, activeActivities: HubActivity[]): string | null {
  const activity = preferredReplyLineActivity(thread, activeActivities)
  return activity ? activityLinePhone(activity) : null
}

function prospectSource(activity: HubActivity): string | null {
  const meta = activityMetadata(activity)
  return textValue(meta.source) || textValue(meta.trigger)
}

function isSystemAlert(activity: HubActivity): boolean {
  const direction = textValue(activityMetadata(activity).direction)?.toLowerCase()
  return direction === 'outbound_alert'
}

function activityTimeMs(activity: HubActivity | null | undefined): number {
  if (!activity) return 0
  const time = new Date(activity.created_at).getTime()
  return Number.isFinite(time) ? time : 0
}

function hubWorkflowAction(activity: HubActivity): ThreadWorkflowAction | null {
  const action = textValue(activityMetadata(activity).hub_action)
  return action && THREAD_WORKFLOW_ACTIONS.has(action as ThreadWorkflowAction) ? action as ThreadWorkflowAction : null
}

function isHubWorkflowActivity(activity: HubActivity): boolean {
  return Boolean(hubWorkflowAction(activity))
}

function activityTagId(activity: HubActivity): string | null {
  const meta = activityMetadata(activity)
  return normalizeTagId(textValue(meta.hub_tag) || textValue(meta.tag) || textValue(meta.tag_name) || '')
}

function latestHubWorkflowAt(thread: HubThread, action: ThreadWorkflowAction): number {
  return thread.activities.reduce((latest, activity) => (
    hubWorkflowAction(activity) === action ? Math.max(latest, activityTimeMs(activity)) : latest
  ), 0)
}

function latestInboundConversationAt(thread: HubThread): number {
  return thread.activities.reduce((latest, activity) => {
    if (!isConversationActivity(activity) || activityDirection(activity) !== 'inbound') return latest
    return Math.max(latest, activityTimeMs(activity))
  }, 0)
}

function threadIsUnread(thread: HubThread): boolean {
  const readAt = latestHubWorkflowAt(thread, 'mark_read')
  const unreadAt = latestHubWorkflowAt(thread, 'mark_unread')
  const inboundAt = latestInboundConversationAt(thread)
  return unreadAt > readAt || inboundAt > readAt
}

function activeReminderActivity(thread: HubThread): HubActivity | null {
  const completedAt = latestHubWorkflowAt(thread, 'reminder_completed')
  return thread.activities
    .filter((activity) => hubWorkflowAction(activity) === 'reminder_created' && activityTimeMs(activity) > completedAt)
    .sort((a, b) => activityTimeMs(b) - activityTimeMs(a))[0] || null
}

function threadReminderState(thread: HubThread): ThreadReminderState {
  const activity = activeReminderActivity(thread)
  if (!activity) return { active: false, dueAt: null, note: null }
  const meta = activityMetadata(activity)
  return {
    active: true,
    dueAt: textValue(meta.reminder_due_at),
    note: textValue(meta.reminder_note),
  }
}

function reminderDueLabel(dueAt: string | null): string {
  if (!dueAt) return 'soon'
  const date = new Date(dueAt)
  if (Number.isNaN(date.getTime())) return 'soon'
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (date.toDateString() === today.toDateString()) return `today at ${fullTime(dueAt)}`
  if (date.toDateString() === tomorrow.toDateString()) return `tomorrow at ${fullTime(dueAt)}`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function explicitThreadTagIds(thread: HubThread): string[] {
  const tags = new Set<string>()
  for (const activity of sortedAscending(thread.activities)) {
    const action = hubWorkflowAction(activity)
    if (action !== 'tag_added' && action !== 'tag_removed') continue
    const tag = activityTagId(activity)
    if (!tag) continue
    if (action === 'tag_removed') tags.delete(tag)
    else tags.add(tag)
  }
  return Array.from(tags)
}

function derivedThreadTagIds(thread: HubThread): string[] {
  const tags = new Set<string>()
  const station = normalizeTagId(thread.lead?.station || '')
  if (station === 'appointment_set' || station === 'appt_set') tags.add('appointment_made')
  if (station === 'under_contract' || station === 'contract_signed') tags.add('under_contract')
  if (station === 'closed' || station === 'closed_won') tags.add('closed_deal')
  if (station === 'closed_lost' || station === 'dead' || station === 'not_interested') tags.add('sold')
  if (thread.activities.some((activity) => activity.activity_type === 'voicemail')) tags.add('voicemail')
  return Array.from(tags)
}

function threadTagIds(thread: HubThread): string[] {
  return Array.from(new Set([...explicitThreadTagIds(thread), ...derivedThreadTagIds(thread)]))
}

function threadMatchesTag(thread: HubThread, tagId: string): boolean {
  const normalized = normalizeTagId(tagId)
  return Boolean(normalized && threadTagIds(thread).includes(normalized))
}

function normalizeProspectPhone(row: ProspectPhoneRow): ProspectPhoneContext | null {
  const prospect = Array.isArray(row.prospects) ? row.prospects[0] : row.prospects
  if (!prospect?.lead_id && !row.phone) return null
  return {
    id: row.id,
    phone: row.phone,
    contact_name: row.contact_name,
    relationship: row.relationship,
    lead_id: prospect?.lead_id || null,
    owner_1: prospect?.owner_1 || null,
    is_deceased: prospect?.is_deceased ?? null,
    delinquent_years_category: prospect?.delinquent_years_category || null,
  }
}

function prospectLabel(context: ProspectPhoneContext | null): string | null {
  if (!context) return null
  const labels = [
    context.relationship ? toProperCase(context.relationship) : null,
    context.is_deceased ? 'Heir outreach' : 'Prospect',
    context.delinquent_years_category === '3yr_plus' ? '3yr+' : context.delinquent_years_category,
  ].filter(Boolean)
  return labels.length ? labels.join(' - ') : null
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '??'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function displayName(lead: HubLead | null, phone: string | null): string {
  if (lead?.full_name && lead.full_name !== lead.phone) return toProperCase(lead.full_name)
  return formatPhone(phone || lead?.phone || '') || 'Unknown Seller'
}

function leadPropertySummary(lead: HubLead | null): string | null {
  if (!lead) return null
  const address = textValue(lead.property_address)
  const city = textValue(lead.city)
  const state = textValue(lead.state)
  const locality = [city, state].filter(Boolean).join(', ')
  if (!address) return locality || null
  const addressLower = address.toLowerCase()
  const addressTokens = address.toUpperCase().split(/[^A-Z0-9]+/)
  const alreadyHasCity = Boolean(city && addressLower.includes(city.toLowerCase()))
  const alreadyHasState = Boolean(state && addressTokens.includes(state.toUpperCase()))
  if (locality && !alreadyHasCity && !alreadyHasState) return `${address}, ${locality}`
  return address
}

function activityHeirName(activity: HubActivity): string | null {
  const meta = activityMetadata(activity)
  return textValue(meta.heir_name) || textValue(meta.contact_name)
}

function activityDecedentName(activity: HubActivity): string | null {
  const meta = activityMetadata(activity)
  return textValue(meta.prospect_owner_name) ||
    textValue(meta.decedent_name) ||
    textValue(meta.deceased_owner_name) ||
    textValue(meta.owner_1) ||
    textValue(meta.owner_name)
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const first = personDisplayName(a)
  const second = personDisplayName(b)
  return Boolean(first && second && first.toLowerCase() === second.toLowerCase())
}

function withoutSingleLetterMiddleInitials(parts: string[]): string[] {
  if (parts.length < 3) return parts
  return parts.filter((part, index) => index === 0 || index === parts.length - 1 || !/^[A-Za-z]\.?$/.test(part))
}

function personDisplayName(value: string | null | undefined): string | null {
  const name = textValue(value)
  if (!name) return null
  const normalized = name.replace(/\s+/g, ' ').trim()
  const commaIndex = normalized.indexOf(',')

  if (commaIndex > 0) {
    const lastName = normalized.slice(0, commaIndex).replace(/[.,]+$/g, '').trim()
    const firstSide = normalized.slice(commaIndex + 1).trim()
    const firstParts = withoutSingleLetterMiddleInitials(firstSide.split(/\s+/).filter(Boolean))
    const firstName = firstParts[0]
    if (firstName && lastName) return toProperCase(`${firstName} ${lastName}`)
  }

  return toProperCase(withoutSingleLetterMiddleInitials(normalized.split(/\s+/).filter(Boolean)).join(' '))
}

function threadHeirName(thread: HubThread | null): string | null {
  if (!thread) return null
  return thread.prospectPhone?.contact_name ||
    thread.activities.map(activityHeirName).find(Boolean) ||
    (thread.prospectPhone?.relationship && !sameName(thread.name, thread.prospectPhone.owner_1) ? thread.name : null)
}

function threadDecedentName(thread: HubThread | null): string | null {
  if (!thread) return null
  return thread.prospectPhone?.owner_1 ||
    thread.activities.map(activityDecedentName).find(Boolean) ||
    null
}

function threadRelationship(thread: HubThread | null): string | null {
  if (!thread) return null
  return thread.prospectPhone?.relationship ||
    thread.activities.map((activity) => textValue(activityMetadata(activity).heir_relation)).find(Boolean) ||
    null
}

function threadRelationshipLabel(thread: HubThread | null): string {
  return personDisplayName(threadRelationship(thread)) || 'Unknown'
}

function threadPrimaryName(thread: HubThread | null): string {
  if (!thread) return 'Unknown Seller'
  return personDisplayName(threadHeirName(thread)) || personDisplayName(thread.name) || thread.name || 'Unknown Seller'
}

function threadPrimaryTitle(thread: HubThread | null): string {
  if (!thread) return 'Unknown Seller'
  const heir = personDisplayName(threadHeirName(thread))
  if (heir) return `${threadPrimaryName(thread)} (${threadRelationshipLabel(thread)})`
  return threadPrimaryName(thread)
}

function threadSecondaryTitle(thread: HubThread | null): string | null {
  if (!thread) return null
  const decedent = personDisplayName(threadDecedentName(thread))
  if (!decedent || sameName(decedent, threadHeirName(thread))) return null
  return `${decedent} (${thread.prospectPhone?.is_deceased === false ? 'Owner' : 'Decedent'})`
}

function threadIdentityParts(thread: HubThread | null): string[] {
  if (!thread) return []
  return [threadPrimaryTitle(thread), threadSecondaryTitle(thread)].filter(Boolean) as string[]
}

function threadIdentitySummary(thread: HubThread | null): string | null {
  const parts = threadIdentityParts(thread)
  return parts.length > 0 ? parts.join(' - ') : null
}

function threadDisplayInitials(thread: HubThread): string {
  return getInitials(threadPrimaryName(thread))
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fullTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function dayLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function durationLabel(value: unknown): string {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function threadSnippet(activity: HubActivity | null): string {
  if (!activity) return 'No conversation yet'
  if (activity.activity_type === 'call') return activityDirection(activity) === 'inbound' ? 'Inbound call' : 'Outbound call'
  if (activity.activity_type === 'voicemail') return 'Voicemail'
  if (activity.activity_type === 'email') return activityBody(activity) || 'Email'
  if (activity.activity_type === 'note') return `Note: ${activityBody(activity)}`
  if (activity.activity_type === 'status_change' || activity.activity_type === 'outcome') return activityBody(activity) || 'Status updated'
  if (activity.activity_type === 'appointment' || activity.activity_type === 'task') return activityBody(activity) || 'Task'
  return activityBody(activity) || 'Text message'
}

function groupByDay(activities: HubActivity[]): Array<{ day: string; items: HubActivity[] }> {
  const groups: Array<{ day: string; items: HubActivity[] }> = []
  for (const activity of activities) {
    const day = dayLabel(activity.created_at)
    const last = groups[groups.length - 1]
    if (last?.day === day) last.items.push(activity)
    else groups.push({ day, items: [activity] })
  }
  return groups
}

function buildThreadForProspectPhone({
  id,
  phone,
  lead,
  prospectPhone,
  activities,
}: {
  id: string
  phone: string | null
  lead: HubLead | null
  prospectPhone: ProspectPhoneContext | null
  activities: HubActivity[]
}): HubThread {
  const sorted = activities.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const lastActivity = sorted.find((activity) => !isHubWorkflowActivity(activity)) || sorted[0] || null
  const lastConversation = sorted.find(isConversationActivity) || null
  const display = prospectPhone?.contact_name || displayName(lead, phone || prospectPhone?.phone || null)
  const thread = {
    id,
    lead,
    prospectPhone,
    phone: phone || prospectPhone?.phone || lead?.phone || null,
    name: display,
    initials: getInitials(display || phone || lead?.full_name || lead?.phone),
    lastActivity,
    unread: Boolean(lastConversation && activityDirection(lastConversation) === 'inbound'),
    starred: lead?.priority === 'hot' || lead?.priority === 'high',
    activities: sorted,
  }
  return { ...thread, unread: threadIsUnread(thread) }
}

function sortedAscending(activities: HubActivity[]): HubActivity[] {
  return activities.slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}

function smsActivities(thread: HubThread): HubActivity[] {
  return thread.activities.filter(isSmsActivity)
}

function latestSmsByDirection(thread: HubThread, direction: 'inbound' | 'outbound'): HubActivity | null {
  return smsActivities(thread).find((activity) => activityDirection(activity) === direction) || null
}

function latestInbound(thread: HubThread): HubActivity | null {
  return latestSmsByDirection(thread, 'inbound')
}

function latestOutbound(thread: HubThread): HubActivity | null {
  return latestSmsByDirection(thread, 'outbound')
}

function latestConversation(thread: HubThread): HubActivity | null {
  return thread.activities.find(isConversationActivity) || null
}

function threadNeedsReply(thread: HubThread): boolean {
  const last = latestConversation(thread)
  return Boolean(last && activityDirection(last) === 'inbound' && (isSmsActivity(last) || last.activity_type === 'email' || last.activity_type === 'call'))
}

function threadIsUnanswered(thread: HubThread): boolean {
  const outbound = latestOutbound(thread)
  if (!outbound) return false
  const inbound = latestInbound(thread)
  return !inbound || new Date(inbound.created_at).getTime() < new Date(outbound.created_at).getTime()
}

function threadIsDripReady(thread: HubThread): boolean {
  if (threadNeedsReply(thread)) return false
  const outbound = latestOutbound(thread)
  if (!outbound) return false
  const days = Math.floor((Date.now() - new Date(outbound.created_at).getTime()) / 86_400_000)
  return days >= 3
}

function threadHasReminder(thread: HubThread): boolean {
  if (threadReminderState(thread).active || threadIsDripReady(thread)) return true
  return thread.activities.some((activity) => {
    const meta = activityMetadata(activity)
    return activity.activity_type === 'task' ||
      activity.activity_type === 'appointment' ||
      Boolean(textValue(meta.reminder_at) || textValue(meta.next_follow_up_at) || textValue(meta.follow_up_at))
  })
}

function threadHasNoStatus(thread: HubThread): boolean {
  const station = (thread.lead?.station || '').trim().toLowerCase()
  return !station || station === 'new' || station === 'no_status' || station === 'no status'
}

function threadStatus(thread: HubThread): string {
  if (threadNeedsReply(thread)) return 'Needs reply'
  if (threadHasReminder(thread)) return 'Reminder'
  if (threadHasNoStatus(thread)) return 'No Status'
  if (threadIsDripReady(thread)) return 'Drip ready'
  if (threadIsUnanswered(thread)) return 'Unanswered'
  if (!thread.lead?.assigned_agent) return 'Unassigned'
  return 'Nurturing'
}

function threadRowSignals(thread: HubThread): ThreadRowSignal[] {
  const phoneStatus = phoneStatusFromActivities(thread.activities)
  const suppressed = SUPPRESSED_PHONE_STATUSES.has(phoneStatus)
  return [
    { id: 'unread', label: 'Unread', icon: 'mail', active: thread.unread, color: '#5867E8' },
    { id: 'unanswered', label: 'Unanswered', icon: 'hourglass_empty', active: threadIsUnanswered(thread), color: '#2EA8E5' },
    { id: 'hot', label: 'Hot', icon: 'local_fire_department', active: thread.starred, color: '#EF4D6D' },
    { id: 'reminder', label: 'Reminder', icon: 'notifications', active: threadHasReminder(thread), color: '#EF4D6D' },
    { id: 'drip', label: 'Drip ready', icon: 'water_drop', active: threadIsDripReady(thread), color: '#7D9BFF' },
    { id: 'no_status', label: 'No Status', icon: 'question_mark', active: threadHasNoStatus(thread), color: '#F7B955' },
    {
      id: 'phone_quality',
      label: suppressed ? PHONE_STATUS_LABELS[phoneStatus] : 'Phone OK',
      icon: suppressed ? 'block' : 'check',
      active: suppressed || phoneStatus === 'verified',
      color: suppressed ? '#EF4D6D' : '#72D398',
    },
  ]
}

function averageReplyMetric(threads: HubThread[]): ReplyMetric {
  const deltas: number[] = []
  for (const thread of threads) {
    let lastOutboundAt: number | null = null
    for (const activity of sortedAscending(smsActivities(thread))) {
      const at = new Date(activity.created_at).getTime()
      if (!Number.isFinite(at)) continue
      if (activityDirection(activity) === 'outbound') {
        lastOutboundAt = at
      } else if (lastOutboundAt != null && at > lastOutboundAt) {
        deltas.push(Math.max(0, Math.round((at - lastOutboundAt) / 60000)))
        lastOutboundAt = null
      }
    }
  }

  if (deltas.length === 0) return { count: 0, averageMinutes: null }
  const total = deltas.reduce((sum, value) => sum + value, 0)
  return { count: deltas.length, averageMinutes: Math.round(total / deltas.length) }
}

function replyMetricLabel(metric: ReplyMetric): string {
  if (metric.averageMinutes == null) return 'No replies yet'
  if (metric.averageMinutes < 60) return `${metric.averageMinutes} min`
  const hours = metric.averageMinutes / 60
  return hours < 24 ? `${hours.toFixed(1)} hr` : `${Math.round(hours / 24)} days`
}

function weekKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

function templateMergeFields(body: string): string[] {
  return Array.from(new Set(Array.from(body.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)).map((match) => match[1])))
}

function templateVariations(body: string): number {
  const spinnerMatches = Array.from(body.matchAll(/\{([^{}|]+(?:\|[^{}|]+)+)\}/g))
  return spinnerMatches.reduce((product, match) => {
    const count = match[1].split('|').map((part) => part.trim()).filter(Boolean).length
    return product * Math.max(1, count)
  }, 1)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function keywordScanText(body: string): string {
  return body.replace(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g, ' ').toLowerCase()
}

function keywordMatches(text: string, keyword: string): boolean {
  const normalizedKeyword = keyword.toLowerCase()
  if (/\s|-/.test(normalizedKeyword)) return text.includes(normalizedKeyword)
  return new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`, 'i').test(text)
}

function templateCompliance(body: string) {
  const keywordText = keywordScanText(body)
  const restricted = RESTRICTED_WORDS.filter((word) => keywordMatches(keywordText, word))
  const negatives = NEGATIVE_KEYWORDS.filter((word) => keywordMatches(keywordText, word))
  const hasOptOut = /stop|unsubscribe|opt out/i.test(body)
  const hasMerge = templateMergeFields(body).length > 0
  const isLong = body.length > 320
  return {
    restricted,
    negatives,
    hasOptOut,
    hasMerge,
    isLong,
    score: [restricted.length === 0, negatives.length === 0, hasMerge, !isLong].filter(Boolean).length,
  }
}

function templateCategoryLabel(category: string): string {
  return TEMPLATE_CATEGORY_LABELS[category as TemplateCategory] || templateDisplayName(category)
}

function templateDisplayName(name: string): string {
  return toProperCase(name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim())
}

function isProspectingTemplate(template: SmsTemplateRow): boolean {
  return PROSPECTING_TEMPLATE_CATEGORY_SET.has(template.category)
}

function prospectingTemplateLibrary(savedTemplates: SmsTemplateRow[]): SmsTemplateRow[] {
  const prospectingTemplates = savedTemplates.filter(isProspectingTemplate)
  const savedNames = new Set(prospectingTemplates.map((template) => template.name.trim().toLowerCase()))
  const seedTemplates = PROSPECTING_TEMPLATE_SEEDS.filter((template) => !savedNames.has(template.name.trim().toLowerCase()))
  return [...prospectingTemplates, ...seedTemplates].sort((a, b) => {
    const aIndex = TEMPLATE_CATEGORIES.indexOf(a.category as TemplateCategory)
    const bIndex = TEMPLATE_CATEGORIES.indexOf(b.category as TemplateCategory)
    const categoryDiff = (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex)
    if (categoryDiff !== 0) return categoryDiff
    return templateDisplayName(a.name).localeCompare(templateDisplayName(b.name))
  })
}

function renderSpinnerPreview(body: string): string {
  return body.replace(/\{([^{}|]+(?:\|[^{}|]+)+)\}/g, (_, group: string) => {
    return group.split('|').map((part) => part.trim()).filter(Boolean)[0] || ''
  })
}

function firstNameForThread(thread: HubThread | null): string {
  const name = threadHeirName(thread) || thread?.lead?.full_name || thread?.name || ''
  const first = name.trim().split(/\s+/)[0]
  return first && !first.includes('(') ? toProperCase(first) : 'there'
}

function mergeComposerBody(body: string, thread: HubThread | null, agent: string): string {
  const propertyAddress = thread?.lead?.property_address || 'the property'
  const mailingAddress = [thread?.lead?.city, thread?.lead?.state].filter(Boolean).join(', ')
  return renderSpinnerPreview(body)
    .replace(/\{firstName\}/gi, firstNameForThread(thread))
    .replace(/\{propertyAddress\}/gi, propertyAddress)
    .replace(/\{mailingAddress\}/gi, mailingAddress || propertyAddress)
    .replace(/\{agentName\}/gi, agent)
    .replace(/\{companyName\}/gi, 'Saving KC Homebuyers')
}

function smsSegmentMetric(body: string): SmsSegmentMetric {
  const characters = Array.from(body).length
  const unicode = Array.from(body).some((char) => char.charCodeAt(0) > 127)
  const singleLimit = unicode ? 70 : 160
  const multiLimit = unicode ? 67 : 153
  const segments = characters === 0 ? 0 : characters <= singleLimit ? 1 : Math.ceil(characters / multiLimit)
  return {
    encoding: unicode ? 'Unicode' : 'GSM',
    characters,
    segments,
    remaining: Math.max(0, (segments <= 1 ? singleLimit : segments * multiLimit) - characters),
  }
}

function composerWarnings(body: string): string[] {
  const keywordText = keywordScanText(body)
  const restricted = RESTRICTED_WORDS.filter((word) => keywordMatches(keywordText, word))
  const negatives = NEGATIVE_KEYWORDS.filter((word) => keywordMatches(keywordText, word))
  const warnings: string[] = []
  if (restricted.length > 0) warnings.push(`Restricted: ${restricted.join(', ')}`)
  if (negatives.length > 0) warnings.push(`Carrier-risk: ${negatives.join(', ')}`)
  if (smsSegmentMetric(body).encoding === 'Unicode') warnings.push('Unicode characters reduce segment size')
  if (body.length > 320) warnings.push('Long reply')
  return warnings
}

function phoneStatusFromActivities(activities: HubActivity[]): PhoneQualityStatus {
  const statusActivity = activities.slice().reverse().find((activity) => {
    const status = textValue(activityMetadata(activity).phone_status)
    return status === 'verified' || status === 'wrong_number' || status === 'dnc' || status === 'spam' || status === 'blocked'
  })
  const status = textValue(statusActivity ? activityMetadata(statusActivity).phone_status : null)
  return status === 'verified' || status === 'wrong_number' || status === 'dnc' || status === 'spam' || status === 'blocked' ? status : 'unknown'
}

function campaignListOption(id: CampaignListKey) {
  return CAMPAIGN_LIST_OPTIONS.find((option) => option.id === id) || CAMPAIGN_LIST_OPTIONS[0]
}

function defaultCampaignDraft(): CampaignDraft {
  const option = campaignListOption('heir_prospecting')
  return {
    name: `${option.label} Campaign`,
    listKey: option.id,
    market: CAMPAIGN_MARKETS[0],
    callForwardingNumber: '',
    templateCategory: option.templateCategory,
    dailyCap: 125,
    statusFilter: 'ready',
    startWindow: '9:00 AM',
    stopWindow: '6:00 PM',
  }
}

function campaignSignalText(thread: HubThread): string {
  const activityBits = thread.activities.flatMap((activity) => {
    const meta = activityMetadata(activity)
    return [
      activity.activity_type,
      activity.description,
      activityBody(activity),
      prospectSource(activity),
      textValue(meta.source),
      textValue(meta.trigger),
      textValue(meta.campaign),
      textValue(meta.campaign_name),
      textValue(meta.list),
      textValue(meta.list_name),
      textValue(meta.template_category),
      textValue(meta.prospect_owner_name),
      textValue(meta.decedent_name),
      textValue(meta.owner_1),
      textValue(meta.heir_name),
      textValue(meta.heir_relation),
    ]
  })
  return [
    thread.name,
    thread.phone,
    thread.prospectPhone?.contact_name,
    thread.prospectPhone?.relationship,
    thread.prospectPhone?.owner_1,
    thread.prospectPhone?.delinquent_years_category,
    thread.prospectPhone?.is_deceased ? 'deceased decedent estate heir' : null,
    thread.lead?.full_name,
    thread.lead?.source,
    thread.lead?.station,
    thread.lead?.priority,
    thread.lead?.county,
    thread.lead?.notes,
    thread.lead?.property_address,
    ...activityBits,
  ].filter(Boolean).join(' ').toLowerCase()
}

function threadMatchesCampaignList(thread: HubThread, listKey: CampaignListKey): boolean {
  if (listKey === 'all_prospecting') return true

  const signal = campaignSignalText(thread)
  const delinquentCategory = thread.prospectPhone?.delinquent_years_category || ''

  if (listKey === 'heir_prospecting') {
    return Boolean(
      thread.prospectPhone ||
      threadRelationship(thread) ||
      signal.includes('heir') ||
      signal.includes('estate') ||
      signal.includes('deceased') ||
      signal.includes('decedent'),
    )
  }

  if (listKey === 'pre_auction_delinquent') {
    return [
      'pre auction',
      'pre-auction',
      'auction',
      'tax sale',
      'tax-sale',
      'sheriff sale',
      'sale list',
    ].some((term) => signal.includes(term))
  }

  if (listKey === 'excess_proceeds') {
    return ['excess', 'proceeds', 'surplus', 'overage'].some((term) => signal.includes(term))
  }

  if (listKey === 'general_two_year_delinquent') {
    return delinquentCategory === '2yr' || [
      '2yr',
      '2 yr',
      '2-year',
      '2 year',
      'two year',
      'two-year',
    ].some((term) => signal.includes(term))
  }

  if (listKey === 'three_plus_delinquent') {
    return delinquentCategory === '3yr_plus' || [
      '3yr',
      '3 yr',
      '3+',
      '3-year',
      '3 year',
      'three year',
      'three-year',
      'older delinquent',
    ].some((term) => signal.includes(term))
  }

  return false
}

function threadMatchesHubFilter(thread: HubThread, nextFilter: HubFilter): boolean {
  if (nextFilter === 'unread') return thread.unread
  if (nextFilter === 'needs_reply') return threadNeedsReply(thread)
  if (nextFilter === 'unanswered') return threadIsUnanswered(thread)
  if (nextFilter === 'reminders') return threadHasReminder(thread)
  if (nextFilter === 'no_status') return threadHasNoStatus(thread)
  if (nextFilter === 'hot') return thread.starred
  if (nextFilter === 'drip_ready') return threadIsDripReady(thread)
  if (nextFilter === 'unassigned') return !thread.lead?.assigned_agent
  return true
}

function threadMatchesCampaignStatus(thread: HubThread, statusFilter: CampaignStatusFilter): boolean {
  if (statusFilter === 'ready') {
    const phoneStatus = phoneStatusFromActivities(thread.activities)
    return !SUPPRESSED_PHONE_STATUSES.has(phoneStatus) && !threadNeedsReply(thread) && (!latestOutbound(thread) || threadIsDripReady(thread))
  }
  return threadMatchesHubFilter(thread, statusFilter)
}

function filterCampaignThreads(threads: HubThread[], draft: CampaignDraft): HubThread[] {
  return threads.filter((thread) => (
    threadMatchesCampaignList(thread, draft.listKey) &&
    threadMatchesCampaignStatus(thread, draft.statusFilter)
  ))
}

function campaignLastTouch(threads: HubThread[]): string | null {
  const latest = threads.reduce<number | null>((current, thread) => {
    const at = new Date(thread.lastActivity?.created_at || thread.lead?.updated_at || thread.lead?.created_at || 0).getTime()
    if (!Number.isFinite(at)) return current
    return current == null ? at : Math.max(current, at)
  }, null)
  return latest == null ? null : new Date(latest).toISOString()
}

function campaignDraftMetrics(threads: HubThread[], dailyCap: number): CampaignDraftMetrics {
  const sent = threads.reduce((sum, thread) => sum + smsActivities(thread).filter((activity) => activityDirection(activity) === 'outbound').length, 0)
  const replies = threads.reduce((sum, thread) => sum + smsActivities(thread).filter((activity) => activityDirection(activity) === 'inbound').length, 0)
  const needsReply = threads.filter(threadNeedsReply).length
  const unanswered = threads.filter(threadIsUnanswered).length
  const dripReady = threads.filter(threadIsDripReady).length
  const suppressed = threads.filter((thread) => SUPPRESSED_PHONE_STATUSES.has(phoneStatusFromActivities(thread.activities))).length
  return {
    audience: threads.length,
    sent,
    replies,
    needsReply,
    unanswered,
    dripReady,
    suppressed,
    responseRate: sent > 0 ? replies / sent : 0,
    batches: Math.max(1, Math.ceil(threads.length / Math.max(1, dailyCap))),
  }
}

function campaignTrackerRows(threads: HubThread[]): CampaignTrackerRow[] {
  return CAMPAIGN_LIST_OPTIONS.map((option) => {
    const matchingThreads = threads.filter((thread) => threadMatchesCampaignList(thread, option.id))
    const metrics = campaignDraftMetrics(matchingThreads, 125)
    const status = metrics.needsReply > 0
      ? 'Needs replies'
      : metrics.dripReady > 0
        ? 'Follow-up ready'
        : metrics.sent === 0
          ? 'Ready'
          : 'Tracking'
    return {
      id: option.id,
      label: option.label,
      description: option.description,
      templateCategory: option.templateCategory,
      audience: metrics.audience,
      sent: metrics.sent,
      replies: metrics.replies,
      needsReply: metrics.needsReply,
      unanswered: metrics.unanswered,
      dripReady: metrics.dripReady,
      suppressed: metrics.suppressed,
      responseRate: metrics.responseRate,
      lastTouchAt: campaignLastTouch(matchingThreads),
      status,
    }
  })
}

function addressQuery(lead: HubLead | null): string {
  return [lead?.property_address, lead?.city, lead?.state, lead?.zip].filter(Boolean).join(', ')
}

function mapsUrl(lead: HubLead | null): string | null {
  const query = addressQuery(lead)
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null
}

function zillowUrl(lead: HubLead | null): string | null {
  const query = addressQuery(lead)
  return query ? `https://www.zillow.com/homes/${encodeURIComponent(query)}_rb/` : null
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

export function DialerConversationHub({
  agent = 'Ernest',
  defaultFromPhone,
  homeTabSwitcher,
}: {
  agent?: string
  defaultFromPhone?: string | null
  homeTabSwitcher?: ReactNode
}) {
  const router = useRouter()
  const [threads, setThreads] = useState<HubThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [activeActivities, setActiveActivities] = useState<HubActivity[]>([])
  const [view, setView] = useState<HubView>('dashboard')
  const [filter, setFilter] = useState<HubFilter>('needs_reply')
  const [search, setSearch] = useState('')
  const [templates, setTemplates] = useState<SmsTemplateRow[]>([])
  const [templateName, setTemplateName] = useState('Initial heir outreach')
  const [templateCategory, setTemplateCategory] = useState<TemplateCategory>('prospecting_intro')
  const [templateBody, setTemplateBody] = useState(DEFAULT_TEMPLATE_BODY)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [templateStatus, setTemplateStatus] = useState<string | null>(null)
  const [campaignDraft, setCampaignDraft] = useState<CampaignDraft>(() => defaultCampaignDraft())
  const [campaignSaving, setCampaignSaving] = useState(false)
  const [campaignStatus, setCampaignStatus] = useState<string | null>(null)
  const [campaignModalOpen, setCampaignModalOpen] = useState(false)
  const [campaignModalKind, setCampaignModalKind] = useState<'initial' | 'follow_up'>('initial')
  const [campaignScope, setCampaignScope] = useState<CampaignListKey | 'all_campaigns'>('all_campaigns')
  const [agentScope, setAgentScope] = useState('all')
  const [tagScope, setTagScope] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [composeMode, setComposeMode] = useState<ComposeMode>('sms')
  const [message, setMessage] = useState('')
  const [fromPhone, setFromPhone] = useState(defaultFromPhone || DEFAULT_FROM_PHONE)
  const [fromPhoneTouched, setFromPhoneTouched] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [showReplyTools, setShowReplyTools] = useState(false)
  const [phoneOptedOut, setPhoneOptedOut] = useState(false)
  const [workflowBusy, setWorkflowBusy] = useState<ThreadWorkflowAction | null>(null)
  const [workflowStatus, setWorkflowStatus] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const activeThread = useMemo(() => {
    return threads.find((thread) => thread.id === activeThreadId) || threads[0] || null
  }, [activeThreadId, threads])
  const threadPhone = activeThread?.phone || activeThread?.lead?.phone || null
  const activeLeadId = activeThread?.lead?.id || activeThread?.prospectPhone?.lead_id || null
  const activeReminder = useMemo(() => activeThread ? threadReminderState(activeThread) : null, [activeThread])

  const loadThreads = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: prospectRows, error: prospectError } = await supabase
        .from('prospect_phones')
        .select(`
          id,
          phone,
          contact_name,
          relationship,
          prospects (
            lead_id,
            owner_1,
            is_deceased,
            delinquent_years_category
          )
        `)
        .not('phone', 'is', null)
        .limit(5000)
      if (prospectError) throw new Error(prospectError.message)

      const prospectPhones = ((prospectRows || []) as ProspectPhoneRow[])
        .map(normalizeProspectPhone)
        .filter((row): row is ProspectPhoneContext => Boolean(row))
      const prospectLeadIds = Array.from(new Set(prospectPhones.map((row) => row.lead_id).filter(Boolean) as string[]))
      const prospectLeadIdSet = new Set(prospectLeadIds)
      const prospectPhonesById = new Map(prospectPhones.filter((row) => row.id).map((row) => [row.id as string, row]))
      const prospectPhonesByPhone = new Map<string, ProspectPhoneContext[]>()
      for (const prospectPhone of prospectPhones) {
        const key = phoneKey(prospectPhone.phone)
        if (!key) continue
        prospectPhonesByPhone.set(key, [...(prospectPhonesByPhone.get(key) || []), prospectPhone])
      }

      function contextForActivity(activity: HubActivity): ProspectPhoneContext | null {
        const meta = activityMetadata(activity)
        const prospectPhoneId = textValue(meta.prospect_phone_id)
        if (prospectPhoneId && prospectPhonesById.has(prospectPhoneId)) {
          return prospectPhonesById.get(prospectPhoneId) || null
        }
        const key = phoneKey(activityPhone(activity, null))
        const matches = key ? prospectPhonesByPhone.get(key) || [] : []
        return matches.find((match) => match.lead_id && match.lead_id === activity.lead_id) || matches[0] || null
      }

      const activityById = new Map<string, HubActivity>()
      async function addActivityRows(rows: HubActivity[] | null | undefined) {
        for (const row of rows || []) activityById.set(row.id, row)
      }

      for (const leadChunk of chunks(prospectLeadIds, 250)) {
        const { data: activityRows, error: activityError } = await supabase
          .from('lead_activities')
          .select('id, lead_id, activity_type, description, agent, metadata, created_at')
          .in('lead_id', leadChunk)
          .in('activity_type', PROSPECTING_ACTIVITY_TYPES)
          .order('created_at', { ascending: false })
          .limit(900)
        if (activityError) throw new Error(activityError.message)
        await addActivityRows((activityRows || []) as HubActivity[])
      }

      for (const source of ['heir_dialer', 'dialer_prospecting_hub', 'dialer_conversation_hub']) {
        const { data: sourceRows } = await supabase
          .from('lead_activities')
          .select('id, lead_id, activity_type, description, agent, metadata, created_at')
          .eq('metadata->>source', source)
          .in('activity_type', PROSPECTING_ACTIVITY_TYPES)
          .order('created_at', { ascending: false })
          .limit(300)
        await addActivityRows((sourceRows || []) as HubActivity[])
      }

      const activityRows = Array.from(activityById.values())
        .filter((activity) => !isSystemAlert(activity))
        .filter((activity) => {
          const source = prospectSource(activity)
          if (source && PROSPECTING_ACTIVITY_SOURCES.has(source)) return true
          const hasProspectLead = Boolean(activity.lead_id && prospectLeadIdSet.has(activity.lead_id))
          const hasProspectPhone = Boolean(contextForActivity(activity))
          return hasProspectLead || hasProspectPhone
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 1200)

      const leadIds = Array.from(new Set(activityRows.map((activity) => activity.lead_id).filter(Boolean) as string[]))
      let leads: HubLead[] = []
      for (const leadChunk of chunks(leadIds, 500)) {
        const { data: leadRows, error: leadError } = await supabase
          .from('leads')
          .select('id, full_name, phone, email, property_address, city, state, zip, county, source, station, priority, assigned_agent, notes, created_at, updated_at')
          .in('id', leadChunk)
        if (leadError) throw new Error(leadError.message)
        leads = [...leads, ...((leadRows || []) as HubLead[])]
      }
      const leadById = new Map(leads.map((lead) => [lead.id, lead]))
      const threadGroups = new Map<string, { phone: string | null; leadId: string | null; prospectPhone: ProspectPhoneContext | null; activities: HubActivity[] }>()
      for (const activity of activityRows) {
        const prospectPhone = contextForActivity(activity)
        const phone = activityPhone(activity, null)
        const key = phoneKey(phone || prospectPhone?.phone || null)
        const leadId = activity.lead_id || prospectPhone?.lead_id || null
        if (!key && !leadId) continue
        const id = key ? `phone:${key}` : `lead:${leadId}`
        const current = threadGroups.get(id) || {
          phone: phone || prospectPhone?.phone || null,
          leadId,
          prospectPhone,
          activities: [],
        }
        current.phone = current.phone || phone || prospectPhone?.phone || null
        current.leadId = current.leadId || leadId
        current.prospectPhone = current.prospectPhone || prospectPhone
        current.activities.push(activity)
        threadGroups.set(id, current)
      }

      const nextThreads = Array.from(threadGroups.entries()).map(([id, group]) => (
        buildThreadForProspectPhone({
          id,
          phone: group.phone,
          lead: group.leadId ? leadById.get(group.leadId) || null : null,
          prospectPhone: group.prospectPhone,
          activities: group.activities,
        })
      )).sort((a, b) => {
        const aTime = new Date(a.lastActivity?.created_at || a.lead?.updated_at || a.lead?.created_at || 0).getTime()
        const bTime = new Date(b.lastActivity?.created_at || b.lead?.updated_at || b.lead?.created_at || 0).getTime()
        return bTime - aTime
      })

      setThreads(nextThreads)
      setActiveThreadId((current) => current && nextThreads.some((thread) => thread.id === current)
        ? current
        : nextThreads[0]?.id || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load conversations.')
      setThreads([])
      setActiveThreadId(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadActiveActivities = useCallback(async () => {
    if (!activeThread) {
      setActiveActivities([])
      return
    }
    setActiveActivities(sortedAscending(activeThread.activities).slice(-120))
  }, [activeThread])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  const loadTemplates = useCallback(async () => {
    try {
      const response = await fetch('/api/sms-templates', { cache: 'no-store' })
      const payload = await response.json()
      setTemplates(prospectingTemplateLibrary((payload.templates || []) as SmsTemplateRow[]))
    } catch {
      setTemplates(PROSPECTING_TEMPLATE_SEEDS)
    }
  }, [])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    void loadActiveActivities()
  }, [loadActiveActivities])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [activeThreadId, activeActivities.length])

  useEffect(() => {
    if (!activeThread) return
    const supabase = createClient()
    const channel = supabase
      .channel(`dialer-home-conversation-${activeThread.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'lead_activities',
          ...(activeLeadId ? { filter: `lead_id=eq.${activeLeadId}` } : {}),
        },
        () => {
          void loadActiveActivities()
          void loadThreads()
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeLeadId, activeThread, loadActiveActivities, loadThreads])

  useEffect(() => {
    setMessage('')
    setSendError(null)
    setWorkflowStatus(null)
    setShowReplyTools(false)
    setComposeMode('sms')
  }, [activeThreadId])

  useEffect(() => {
    let cancelled = false
    async function loadOptOutStatus() {
      if (!threadPhone) {
        setPhoneOptedOut(false)
        return
      }
      const supabase = createClient()
      const { data } = await supabase
        .from('sms_opt_outs')
        .select('is_opted_out')
        .eq('phone', threadPhone)
        .eq('is_opted_out', true)
        .maybeSingle()
      if (!cancelled) setPhoneOptedOut(Boolean(data?.is_opted_out))
    }
    void loadOptOutStatus()
    return () => { cancelled = true }
  }, [threadPhone])

  const filteredThreads = useMemo(() => {
    const query = search.trim().toLowerCase()
    return threads.filter((thread) => {
      if (!threadMatchesHubFilter(thread, filter)) return false
      if (campaignScope !== 'all_campaigns' && !threadMatchesCampaignList(thread, campaignScope)) return false
      if (agentScope !== 'all' && (thread.lead?.assigned_agent || 'Unassigned') !== agentScope) return false
      if (tagScope !== 'all') {
        if (!threadMatchesTag(thread, tagScope)) return false
      }
      if (query) {
        const haystack = [
          thread.name,
          thread.phone,
          thread.prospectPhone?.contact_name,
          thread.prospectPhone?.owner_1,
          thread.prospectPhone?.relationship,
          prospectLabel(thread.prospectPhone),
          threadIdentitySummary(thread),
          thread.lead?.email,
          thread.lead?.property_address,
          thread.lead?.city,
          thread.lead?.county,
          thread.lead?.source,
          thread.lead?.station,
          threadStatus(thread),
          threadSnippet(thread.lastActivity),
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [agentScope, campaignScope, filter, search, tagScope, threads])

  const replyFromPhone = useMemo(() => {
    return preferredReplyLine(activeThread, activeActivities) || defaultFromPhone || DEFAULT_FROM_PHONE
  }, [activeActivities, activeThread, defaultFromPhone])
  const replyLineLabel = useMemo(() => {
    const sourceActivity = preferredReplyLineActivity(activeThread, activeActivities)
    if (!sourceActivity) return 'Auto: default conversation line'
    const sourceDirection = activityDirection(sourceActivity) === 'inbound' ? 'last inbound' : 'last sent'
    const line = activityLinePhone(sourceActivity)
    return `Auto: ${sourceDirection} used ${formatPhone(line || '') || line || 'unknown line'}`
  }, [activeActivities, activeThread])

  useEffect(() => {
    setFromPhone(replyFromPhone)
    setFromPhoneTouched(false)
  }, [activeThreadId, replyFromPhone])

  const fromPhoneOptions = useMemo(() => {
    const options: Array<{ label: string; value: string }> = CONVERSATION_TWILIO_NUMBERS.map(({ label, value }) => ({ label, value }))
    const extras = [replyFromPhone, defaultFromPhone].filter(Boolean) as string[]
    for (const value of extras.reverse()) {
      if (!options.some((option) => option.value === value)) {
        options.unshift({
          value,
          label: `${formatPhone(value) || value} - active conversation line`,
        })
      }
    }
    return options
  }, [defaultFromPhone, replyFromPhone])

  const unreadCount = useMemo(() => threads.filter((thread) => thread.unread).length, [threads])
  const needsReplyCount = useMemo(() => threads.filter(threadNeedsReply).length, [threads])
  const unansweredCount = useMemo(() => threads.filter(threadIsUnanswered).length, [threads])
  const remindersCount = useMemo(() => threads.filter(threadHasReminder).length, [threads])
  const noStatusCount = useMemo(() => threads.filter(threadHasNoStatus).length, [threads])
  const dripReadyCount = useMemo(() => threads.filter(threadIsDripReady).length, [threads])
  const unassignedCount = useMemo(() => threads.filter((thread) => !thread.lead?.assigned_agent).length, [threads])
  const hotCount = useMemo(() => threads.filter((thread) => thread.starred).length, [threads])
  const replyMetric = useMemo(() => averageReplyMetric(threads), [threads])
  const agentOptions = useMemo(() => {
    return Array.from(new Set(threads.map((thread) => thread.lead?.assigned_agent || 'Unassigned')))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  }, [threads])
  const tagOptions = useMemo<ConversationTagOption[]>(() => {
    const tagIds = new Set<string>(DEFAULT_CONVERSATION_TAGS.map((tag) => tag.id))
    threads.forEach((thread) => {
      threadTagIds(thread).forEach((tag) => tagIds.add(tag))
    })
    const dynamic = Array.from(tagIds)
      .filter((tag) => !DEFAULT_CONVERSATION_TAG_MAP.has(tag))
      .sort((a, b) => conversationTagLabel(a).localeCompare(conversationTagLabel(b)))
      .map((tag, index) => conversationTagOption(tag, index))
    return [...DEFAULT_CONVERSATION_TAGS, ...dynamic].slice(0, 30)
  }, [threads])
  const trackerRows = useMemo(() => campaignTrackerRows(threads), [threads])
  const selectedCampaignThreads = useMemo(() => filterCampaignThreads(threads, campaignDraft), [campaignDraft, threads])
  const selectedCampaignMetrics = useMemo(() => (
    campaignDraftMetrics(selectedCampaignThreads, campaignDraft.dailyCap)
  ), [campaignDraft.dailyCap, selectedCampaignThreads])
  const selectedCampaignTemplates = useMemo(() => (
    templates.filter((template) => template.category === campaignDraft.templateCategory)
  ), [campaignDraft.templateCategory, templates])

  const recentSmsActivities = useMemo(() => {
    return threads.flatMap((thread) => smsActivities(thread))
  }, [threads])

  const textActivity = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date()
      date.setDate(date.getDate() - (6 - index))
      return { label: date.toLocaleDateString('en-US', { weekday: 'short' }), sent: 0, replies: 0 }
    })
    const byLabel = new Map(days.map((day) => [day.label, day]))
    recentSmsActivities.forEach((activity) => {
      const label = weekKey(activity.created_at)
      const bucket = byLabel.get(label)
      if (!bucket) return
      if (activityDirection(activity) === 'inbound') bucket.replies += 1
      else bucket.sent += 1
    })
    return days
  }, [recentSmsActivities])

  const maxTextActivity = useMemo(() => {
    return Math.max(1, ...textActivity.map((day) => Math.max(day.sent, day.replies)))
  }, [textActivity])

  const campaignMetrics = useMemo<CampaignMetric[]>(() => {
    const map = new Map<string, CampaignMetric>()
    threads.forEach((thread) => {
      const label = thread.lead?.source || 'Uncategorized'
      const current = map.get(label) || { label, sent: 0, replies: 0, active: 0 }
      current.active += 1
      thread.activities.forEach((activity) => {
        if (!isSmsActivity(activity)) return
        if (activityDirection(activity) === 'inbound') current.replies += 1
        else current.sent += 1
      })
      map.set(label, current)
    })
    return Array.from(map.values())
      .sort((a, b) => (b.replies + b.sent) - (a.replies + a.sent))
      .slice(0, 5)
  }, [threads])

  const tagMetrics = useMemo<TagMetric[]>(() => {
    const counts = new Map<string, number>()
    threads.forEach((thread) => {
      threadTagIds(thread).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1))
    })
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count], index) => ({ label: conversationTagLabel(tag), count, tone: conversationTagColor(tag, index) }))
  }, [threads])

  const leadBreakdown = useMemo(() => {
    const hot = threads.filter((thread) => thread.lead?.priority === 'hot').length
    const warm = threads.filter((thread) => thread.lead?.priority === 'high' || thread.lead?.priority === 'normal').length
    const nurture = threads.filter((thread) => ['nurture', 'follow_up', 'contacted'].includes(thread.lead?.station || '')).length
    const drip = dripReadyCount
    const noStatus = threads.filter((thread) => !thread.lead?.station).length
    return [
      { label: 'Hot Leads', value: hot, color: '#E32E2E' },
      { label: 'Warm Leads', value: warm, color: '#F7B955' },
      { label: 'Nurture', value: nurture, color: '#72D398' },
      { label: 'Drips', value: drip, color: '#7D9BFF' },
      { label: 'No Status', value: noStatus, color: '#8A8F98' },
    ]
  }, [dripReadyCount, threads])

  const templateValidation = useMemo(() => templateCompliance(templateBody), [templateBody])
  const templatePreview = useMemo(() => {
    return renderSpinnerPreview(templateBody)
      .replace(/\{firstName\}/g, 'Sandra')
      .replace(/\{propertyAddress\}/g, '4321 Oak St')
      .replace(/\{mailingAddress\}/g, 'Kansas City, MO')
      .replace(/\{agentName\}/g, agent)
      .replace(/\{companyName\}/g, 'Saving KC Homebuyers')
  }, [agent, templateBody])
  const templateFields = useMemo(() => templateMergeFields(templateBody), [templateBody])
  const variationCount = useMemo(() => templateVariations(templateBody), [templateBody])
  const messageMetric = useMemo(() => smsSegmentMetric(message), [message])
  const messageWarnings = useMemo(() => composerWarnings(message), [message])

  const visibleActivities = activeActivities
  const groupedActivities = useMemo(() => groupByDay(visibleActivities), [visibleActivities])

  async function handleSend() {
    const body = message.trim()
    if (!activeThread || !body || sending) return
    if (composeMode === 'sms' && !threadPhone) {
      setSendError('No seller phone number is attached.')
      return
    }
    if (composeMode === 'sms' && phoneOptedOut) {
      setSendError('This number is marked DNC / SMS suppressed.')
      return
    }
    if (composeMode === 'email' && !activeThread.lead?.email) {
      setSendError('No seller email is attached.')
      return
    }

    setSending(true)
    setSendError(null)
    try {
      const response = await fetch('/api/conversations/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(composeMode === 'sms'
          ? {
              leadId: activeLeadId,
              phone: threadPhone,
              body,
              mode: 'sms',
              fromPhone: fromPhoneTouched ? fromPhone : undefined,
              agent,
              source: 'dialer_prospecting_hub',
              prospectPhoneId: activeThread.prospectPhone?.id || undefined,
              heirName: activeThread.prospectPhone?.contact_name || undefined,
              heirRelation: activeThread.prospectPhone?.relationship || undefined,
              prospectOwnerName: activeThread.prospectPhone?.owner_1 || undefined,
            }
          : {
              leadId: activeLeadId,
              to: activeThread.lead?.email,
              body,
              mode: 'email',
              subject: 'Message from Saving KC',
              agent,
              source: 'dialer_prospecting_hub',
              prospectPhoneId: activeThread.prospectPhone?.id || undefined,
              heirName: activeThread.prospectPhone?.contact_name || undefined,
              heirRelation: activeThread.prospectPhone?.relationship || undefined,
              prospectOwnerName: activeThread.prospectPhone?.owner_1 || undefined,
            }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Send failed')

      setMessage('')
      await loadActiveActivities()
      await loadThreads()
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function handleThreadWorkflow(action: ThreadWorkflowAction, dueInDays?: number) {
    if (!activeThread || workflowBusy) return
    const dueAt = action === 'reminder_created'
      ? new Date(Date.now() + (dueInDays ?? 1) * 86_400_000).toISOString()
      : undefined

    setWorkflowBusy(action)
    setWorkflowStatus(null)
    try {
      const response = await fetch('/api/conversations/thread-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: activeLeadId,
          phone: threadPhone,
          action,
          dueAt,
          agent,
          source: 'dialer_prospecting_hub',
          prospectPhoneId: activeThread.prospectPhone?.id || undefined,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Could not update conversation state.')

      const message = action === 'reminder_created'
        ? `Reminder set for ${reminderDueLabel(dueAt || null)}.`
        : action === 'reminder_completed'
          ? 'Reminder completed.'
          : action === 'mark_read'
            ? 'Marked read.'
            : 'Marked unread.'
      setWorkflowStatus(message)
      await loadThreads()
    } catch (err) {
      setWorkflowStatus(err instanceof Error ? err.message : 'Could not update conversation state.')
    } finally {
      setWorkflowBusy(null)
    }
  }

  function insertComposerBody(body: string) {
    setMessage(mergeComposerBody(body, activeThread, agent))
    setShowReplyTools(false)
    setSendError(null)
  }

  async function handleSaveTemplate() {
    const name = templateName.trim()
    const body = templateBody.trim()
    if (!name || !body || templateSaving) return

    setTemplateSaving(true)
    setTemplateStatus(null)
    try {
      const response = await fetch('/api/sms-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          category: templateCategory,
          body,
          merge_fields: templateFields,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Could not save template')
      setTemplateStatus('Template saved.')
      await loadTemplates()
    } catch (err) {
      setTemplateStatus(err instanceof Error ? err.message : 'Could not save template')
    } finally {
      setTemplateSaving(false)
    }
  }

  function updateCampaignDraft(patch: Partial<CampaignDraft>) {
    setCampaignStatus(null)
    setCampaignDraft((current) => {
      const next = { ...current, ...patch }
      if (patch.listKey && patch.listKey !== current.listKey) {
        const option = campaignListOption(patch.listKey)
        next.name = `${option.label} Campaign`
        next.templateCategory = option.templateCategory
      }
      if (patch.dailyCap != null) {
        next.dailyCap = Math.max(1, Math.min(500, Math.floor(Number(patch.dailyCap) || 1)))
      }
      return next
    })
  }

  async function handleSaveCampaignPlan() {
    const name = campaignDraft.name.trim()
    if (!name || campaignSaving) return

    setCampaignSaving(true)
    setCampaignStatus(null)
    try {
      const option = campaignListOption(campaignDraft.listKey)
      const sessionLeadIds = Array.from(new Set(
        selectedCampaignThreads
          .map((thread) => thread.lead?.id || thread.prospectPhone?.lead_id)
          .filter((id): id is string => Boolean(id)),
      ))
      const response = await fetch('/api/dialer/saved-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          agent,
          preset: option.preset,
          callerId: campaignDraft.callForwardingNumber,
          campaign: option.id,
          statusFilter: campaignDraft.statusFilter === 'ready' ? 'all' : campaignDraft.statusFilter,
          priorityFilter: 'all',
          minMotivation: 0,
          search: '',
          sortBy: 'recommended',
          visibleLimit: 25,
          sessionLeadIds,
          optionalFilters: {
            attemptsFrom: '',
            attemptsTo: '',
            notDialed: 'none',
            notContactedDays: campaignDraft.statusFilter === 'drip_ready' ? '3' : 'none',
            createDateFrom: '',
            createDateTo: '',
            statusChangeFrom: '',
            statusChangeTo: '',
            callOldestToNewest: false,
          },
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Could not save campaign list')
      setCampaignStatus(`Saved ${name} with ${sessionLeadIds.length.toLocaleString()} matched lead${sessionLeadIds.length === 1 ? '' : 's'}.`)
      setCampaignModalOpen(false)
    } catch (err) {
      setCampaignStatus(err instanceof Error ? err.message : 'Could not save campaign list')
    } finally {
      setCampaignSaving(false)
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void handleSend()
    }
  }

  const viewTabs: Array<{ id: HubView; label: string; icon: string }> = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'inbox', label: 'Inbox', icon: 'inbox' },
    { id: 'campaigns', label: 'Campaigns', icon: 'campaign' },
    { id: 'templates', label: 'Templates', icon: 'edit_note' },
  ]

  const inboxTabs: Array<{ id: HubFilter; label: string; count?: number }> = [
    { id: 'unread', label: 'Unread', count: unreadCount },
    { id: 'unanswered', label: 'Unanswered', count: unansweredCount },
    { id: 'reminders', label: 'Reminders', count: remindersCount },
    { id: 'no_status', label: 'No Status', count: noStatusCount },
    { id: 'needs_reply', label: 'Needs reply', count: needsReplyCount },
    { id: 'hot', label: 'Hot', count: hotCount },
    { id: 'drip_ready', label: 'Drip ready', count: dripReadyCount },
    { id: 'unassigned', label: 'Unassigned', count: unassignedCount },
    { id: 'recents', label: 'Recents' },
    { id: 'all', label: 'All', count: threads.length },
  ]

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)]">
      <div className="shrink-0 border-b border-[var(--ck-border)] px-4 py-3 sm:px-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
          <div className="justify-self-start">{homeTabSwitcher}</div>
          <MissionControlBar
            unreadCount={unreadCount}
            unansweredCount={unansweredCount}
            remindersCount={remindersCount}
            noStatusCount={noStatusCount}
            onOpen={(nextFilter) => {
              setFilter(nextFilter)
              setView('inbox')
            }}
          />
          <div className="flex flex-wrap items-center gap-2 justify-self-end text-[11px] font-bold text-[var(--ck-text-muted)]">
            <button
              type="button"
              onClick={() => {
                void loadThreads()
                void loadTemplates()
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ck-border)] px-3 text-[var(--ck-text-muted)] transition-colors hover:text-[var(--ck-text)]"
            >
              <Icon name="refresh" size="text-base" /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[76px_minmax(0,1fr)]">
        <HubSideNav tabs={viewTabs} activeView={view} onViewChange={setView} />
        <div className={`${view === 'inbox' ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'h-full min-h-0 overflow-y-auto'}`}>
      {view === 'dashboard' && (
        <HubDashboard
          totalThreads={threads.length}
          unreadCount={unreadCount}
          unansweredCount={unansweredCount}
          remindersCount={remindersCount}
          noStatusCount={noStatusCount}
          replyMetric={replyMetric}
          campaignMetrics={campaignMetrics}
          textActivity={textActivity}
          maxTextActivity={maxTextActivity}
          tagMetrics={tagMetrics}
          leadBreakdown={leadBreakdown}
          onOpenInbox={(nextFilter) => {
            setFilter(nextFilter)
            setView('inbox')
          }}
        />
      )}

      {view === 'campaigns' && (
        <CampaignBuilder
          draft={campaignDraft}
          modalOpen={campaignModalOpen}
          modalKind={campaignModalKind}
          metrics={selectedCampaignMetrics}
          trackerRows={trackerRows}
          templates={selectedCampaignTemplates}
          saving={campaignSaving}
          status={campaignStatus}
          onDraftChange={updateCampaignDraft}
          onSave={() => void handleSaveCampaignPlan()}
          onOpenCreate={(kind) => {
            setCampaignModalKind(kind)
            const nextDraft = defaultCampaignDraft()
            if (kind === 'follow_up') {
              nextDraft.name = 'Follow-up Campaign'
              nextDraft.templateCategory = 'prospecting_follow_up'
              nextDraft.statusFilter = 'drip_ready'
            }
            setCampaignDraft(nextDraft)
            setCampaignStatus(null)
            setCampaignModalOpen(true)
          }}
          onCloseCreate={() => setCampaignModalOpen(false)}
          onOpenInbox={(nextFilter) => {
            setFilter(nextFilter)
            setView('inbox')
          }}
          onOpenTemplates={(category) => {
            setTemplateCategory(category)
            setView('templates')
          }}
        />
      )}

      {view === 'templates' && (
        <TemplateBuilder
          templates={templates}
          templateName={templateName}
          templateCategory={templateCategory}
          templateBody={templateBody}
          templatePreview={templatePreview}
          variationCount={variationCount}
          templateValidation={templateValidation}
          templateSaving={templateSaving}
          templateStatus={templateStatus}
          onNameChange={setTemplateName}
          onCategoryChange={setTemplateCategory}
          onBodyChange={setTemplateBody}
          onLoadTemplate={(template) => {
            const category = template.category as TemplateCategory
            setTemplateName(templateDisplayName(template.name))
            setTemplateCategory(TEMPLATE_CATEGORIES.includes(category) ? category : 'prospecting_intro')
            setTemplateBody(template.body)
            setTemplateStatus(null)
          }}
          onSave={() => void handleSaveTemplate()}
        />
      )}

      {view === 'inbox' && (
        <>
          <div className="shrink-0 border-b border-[var(--ck-border)] px-4 py-3 sm:px-5">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <label className="block">
                    <span className="sr-only">Status</span>
                    <select
                      value={filter}
                      onChange={(event) => setFilter(event.target.value as HubFilter)}
                      className="h-10 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-xs font-black uppercase tracking-wider text-[var(--ck-text)]"
                    >
                      {inboxTabs.map((tab) => (
                        <option key={tab.id} value={tab.id}>{tab.label}{typeof tab.count === 'number' ? ` ${tab.count}` : ''}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="sr-only">Campaigns</span>
                    <select
                      value={campaignScope}
                      onChange={(event) => setCampaignScope(event.target.value as CampaignListKey | 'all_campaigns')}
                      className="h-10 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-xs font-black uppercase tracking-wider text-[var(--ck-text)]"
                    >
                      <option value="all_campaigns">Campaigns</option>
                      {CAMPAIGN_LIST_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="sr-only">Users</span>
                    <select
                      value={agentScope}
                      onChange={(event) => setAgentScope(event.target.value)}
                      className="h-10 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-xs font-black uppercase tracking-wider text-[var(--ck-text)]"
                    >
                      <option value="all">Users</option>
                      {agentOptions.map((agentName) => <option key={agentName} value={agentName}>{agentName}</option>)}
                    </select>
                  </label>
                  <TagFilterDropdown
                    options={tagOptions}
                    selectedTag={tagScope}
                    onSelect={setTagScope}
                  />
                  <button
                    type="button"
                    onClick={() => setFilter('reminders')}
                    className={`h-10 rounded-xl border px-3 text-xs font-black uppercase tracking-wider transition-colors ${
                      filter === 'reminders'
                        ? 'border-[#E32E2E]/45 bg-[#E32E2E] text-white'
                        : 'border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'
                    }`}
                  >
                    Reminders
                  </button>
                </div>
                <div className="relative w-full xl:max-w-[320px]">
                <Icon name="search" size="text-base" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ck-text-dim)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search conversations"
                  className="h-10 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] pl-9 pr-3 text-sm text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
                />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-[var(--ck-text-muted)]">
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Active Filters:</span>
                <FilterChip label={inboxTabs.find((tab) => tab.id === filter)?.label || 'All'} onClear={() => setFilter('all')} />
                {campaignScope !== 'all_campaigns' && <FilterChip label={campaignListOption(campaignScope).label} onClear={() => setCampaignScope('all_campaigns')} />}
                {agentScope !== 'all' && <FilterChip label={agentScope} onClear={() => setAgentScope('all')} />}
                {tagScope !== 'all' && <FilterChip label={conversationTagLabel(tagScope)} onClear={() => setTagScope('all')} />}
                {search.trim() && <FilterChip label={`Search: ${search.trim()}`} onClear={() => setSearch('')} />}
                <button
                  type="button"
                  onClick={() => {
                    setFilter('all')
                    setCampaignScope('all_campaigns')
                    setAgentScope('all')
                    setTagScope('all')
                    setSearch('')
                  }}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[var(--ck-text-dim)] hover:text-[var(--ck-text)]"
                >
                  <Icon name="restart_alt" size="text-sm" /> Reset
                </button>
                <span className="ml-auto hidden text-xs font-semibold text-[var(--ck-text-muted)] xl:block">
                  {INBOX_FILTER_HELP[filter]}
                </span>
              </div>
            </div>
          </div>

      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[330px_minmax(0,1fr)_290px]">
        <aside className="flex min-h-0 flex-col border-b border-[var(--ck-border)] lg:border-b-0 lg:border-r">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--ck-border)] px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">{filteredThreads.length} Results</p>
            <button
              type="button"
              onClick={() => void loadThreads()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ck-border)] text-[var(--ck-text-muted)] transition-colors hover:text-[var(--ck-text)]"
              title="Refresh"
              aria-label="Refresh conversations"
            >
              <Icon name="refresh" size="text-base" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-sm text-[var(--ck-text-muted)]">Loading...</div>
            ) : error ? (
              <div className="p-5 text-sm font-semibold text-[#ff7777]">{error}</div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--ck-text-muted)]">No conversations match.</div>
            ) : (
              filteredThreads.map((thread) => {
                const active = thread.id === activeThread?.id
                const secondaryTitle = threadSecondaryTitle(thread)
                return (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => setActiveThreadId(thread.id)}
                    className={`grid w-full grid-cols-[38px_minmax(0,1fr)_42px] gap-3 border-b border-[var(--ck-border)] px-4 py-3 text-left transition-colors ${
                      active ? 'bg-[#E32E2E]/12 ring-1 ring-inset ring-[#E32E2E]/35' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-black ${
                      thread.unread ? 'bg-cyan-500/20 text-cyan-200' : 'bg-[var(--ck-surface-hi)] text-[var(--ck-text-muted)]'
                    }`}>
                      {threadDisplayInitials(thread)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-black text-[var(--ck-text)]">{threadPrimaryTitle(thread)}</span>
                      </span>
                      <ThreadRowIndicators thread={thread} />
                      <span className="mt-1 block truncate text-[11px] text-[var(--ck-text-muted)]">{threadSnippet(thread.lastActivity)}</span>
                      <span className="mt-1 block truncate text-[10px] text-[var(--ck-text-dim)]">
                        {threadStatus(thread)} - {[secondaryTitle || prospectLabel(thread.prospectPhone), leadPropertySummary(thread.lead) || formatPhone(thread.phone || '')].filter(Boolean).join(' - ') || 'Prospecting conversation'}
                      </span>
                    </span>
                    <span className="pt-0.5 text-right text-[10px] font-bold text-[var(--ck-text-dim)]">{timeAgo(thread.lastActivity?.created_at || thread.lead?.updated_at || thread.lead?.created_at)}</span>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col border-b border-[var(--ck-border)] lg:border-b-0 lg:border-r">
          {activeThread ? (
            <>
              <header className="flex shrink-0 flex-col gap-3 border-b border-[var(--ck-border)] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-lg font-black text-[var(--ck-text)]">{threadPrimaryTitle(activeThread)}</p>
                  {threadSecondaryTitle(activeThread) && (
                    <p className="mt-1 truncate text-xs font-bold text-[var(--ck-text)]">
                      {threadSecondaryTitle(activeThread)}
                    </p>
                  )}
                  <p className="mt-1 truncate text-xs text-[var(--ck-text-muted)]">
                    {[formatPhone(threadPhone || '') || 'No phone', leadPropertySummary(activeThread.lead)].filter(Boolean).join(' - ')}
                  </p>
                </div>
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                    <button
                      type="button"
                      onClick={() => void handleThreadWorkflow(activeThread.unread ? 'mark_read' : 'mark_unread')}
                      disabled={Boolean(workflowBusy)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Icon name={workflowBusy === 'mark_read' || workflowBusy === 'mark_unread' ? 'progress_activity' : activeThread.unread ? 'mark_email_read' : 'mark_email_unread'} size="text-sm" className={workflowBusy === 'mark_read' || workflowBusy === 'mark_unread' ? 'animate-spin' : ''} />
                      {activeThread.unread ? 'Mark Read' : 'Mark Unread'}
                    </button>
                    {activeReminder?.active ? (
                      <button
                        type="button"
                        onClick={() => void handleThreadWorkflow('reminder_completed')}
                        disabled={Boolean(workflowBusy)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100 transition-colors hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Icon name={workflowBusy === 'reminder_completed' ? 'progress_activity' : 'task_alt'} size="text-sm" className={workflowBusy === 'reminder_completed' ? 'animate-spin' : ''} /> Done
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleThreadWorkflow('reminder_created', 1)}
                          disabled={Boolean(workflowBusy)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-amber-300/45 hover:text-[var(--ck-text)] disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <Icon name={workflowBusy === 'reminder_created' ? 'progress_activity' : 'notifications'} size="text-sm" className={workflowBusy === 'reminder_created' ? 'animate-spin' : ''} /> 1d
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleThreadWorkflow('reminder_created', 3)}
                          disabled={Boolean(workflowBusy)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-amber-300/45 hover:text-[var(--ck-text)] disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <Icon name={workflowBusy === 'reminder_created' ? 'progress_activity' : 'event'} size="text-sm" className={workflowBusy === 'reminder_created' ? 'animate-spin' : ''} /> 3d
                        </button>
                      </>
                    )}
                    {activeLeadId && (
                      <button
                        type="button"
                        onClick={() => router.push(`/leads/${activeLeadId}`)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[var(--ck-border-strong)] hover:text-[var(--ck-text)]"
                      >
                        <Icon name="open_in_new" size="text-sm" /> Lead
                      </button>
                    )}
                    {activeLeadId && (
                      <button
                        type="button"
                        onClick={() => router.push(`/dialer?lead_ids=${activeLeadId}&return_to=/dialer`)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#E32E2E] px-3 py-2 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-[#C42626]"
                      >
                        <Icon name="call" size="text-sm" /> Dial
                      </button>
                    )}
                  </div>
                  {(activeReminder?.active || workflowStatus) && (
                    <div className="max-w-full text-right text-[11px] font-bold text-[var(--ck-text-muted)]">
                      {activeReminder?.active && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-amber-100">
                          <Icon name="notifications" size="text-xs" /> Reminder {reminderDueLabel(activeReminder.dueAt)}
                        </span>
                      )}
                      {workflowStatus && (
                        <span className="ml-2 inline-flex rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1 text-[var(--ck-text-muted)]">
                          {workflowStatus}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </header>

              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-black/15 px-5 py-4">
                {groupedActivities.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-[var(--ck-text-dim)]">No messages yet.</div>
                ) : (
                  <div className="space-y-4">
                    {groupedActivities.map((group) => (
                      <div key={group.day} className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1 bg-[var(--ck-border)]" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">{group.day}</span>
                          <div className="h-px flex-1 bg-[var(--ck-border)]" />
                        </div>
                        {group.items.map((activity) => (
                          <ConversationEvent
                            key={activity.id}
                            activity={activity}
                            initials={threadDisplayInitials(activeThread)}
                            phone={threadPhone}
                            participantName={personDisplayName(threadHeirName(activeThread)) || personDisplayName(activeThread.name) || activeThread.name}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <footer className="shrink-0 border-t border-[var(--ck-border)] bg-[var(--ck-surface)]">
                <div className="flex items-center gap-1 px-5 pt-2">
                  {(['sms', 'email'] as ComposeMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setComposeMode(mode)
                        setSendError(null)
                      }}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                        composeMode === mode
                          ? 'bg-[#E32E2E] text-white'
                          : 'text-[var(--ck-text-muted)] hover:bg-white/[0.04] hover:text-[var(--ck-text)]'
                      }`}
                    >
                      Send {mode.toUpperCase()}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowReplyTools((open) => !open)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                      showReplyTools
                        ? 'bg-[#2787ff] text-white'
                        : 'text-[var(--ck-text-muted)] hover:bg-white/[0.04] hover:text-[var(--ck-text)]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="quickreply" size="text-sm" /> Replies
                    </span>
                  </button>
                  {composeMode === 'sms' && (
                    <div className="ml-auto flex min-w-0 flex-col items-end gap-1">
                      <select
                        value={fromPhone}
                        onChange={(event) => {
                          setFromPhone(event.target.value)
                          setFromPhoneTouched(true)
                        }}
                        className="w-full max-w-[260px] rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1.5 text-xs font-semibold text-[var(--ck-text)]"
                      >
                        {fromPhoneOptions.map((number) => (
                          <option key={number.value} value={number.value}>{number.label}</option>
                        ))}
                      </select>
                      <span className="max-w-[260px] truncate text-[10px] font-bold text-[var(--ck-text-dim)]" title={fromPhoneTouched ? 'Manual sender override' : replyLineLabel}>
                        {fromPhoneTouched ? 'Manual sender override' : replyLineLabel}
                      </span>
                    </div>
                  )}
                </div>
                {showReplyTools && (
                  <div className="mx-5 mt-2 grid gap-2 rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-2 lg:grid-cols-2">
                    <div>
                      <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Quick Replies</p>
                      <div className="flex flex-wrap gap-2">
                        {QUICK_REPLIES.map((reply) => (
                          <button
                            key={reply.label}
                            type="button"
                            onClick={() => insertComposerBody(reply.body)}
                            className="rounded-lg border border-[var(--ck-border)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[#2787ff]/50 hover:text-[var(--ck-text)]"
                          >
                            {reply.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Prospecting Templates</p>
                      <div className="grid max-h-32 gap-1 overflow-y-auto pr-1">
                        {templates.length === 0 ? (
                          <p className="text-xs text-[var(--ck-text-muted)]">No prospecting templates.</p>
                        ) : templates.slice(0, 8).map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => insertComposerBody(template.body)}
                            className="truncate rounded-lg border border-[var(--ck-border)] px-2.5 py-1.5 text-left text-[11px] font-bold text-[var(--ck-text-muted)] transition-colors hover:border-[#2787ff]/50 hover:text-[var(--ck-text)]"
                          >
                            {templateDisplayName(template.name)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {composeMode === 'sms' && phoneOptedOut && (
                  <div className="mx-5 mt-3 rounded-xl border border-[#ff7777]/35 bg-[#ff7777]/10 px-3 py-2 text-xs font-bold text-[#ff9b9b]">
                    SMS is suppressed for this number. Remove the DNC status before texting again.
                  </div>
                )}
                <div className="flex items-end gap-3 px-5 py-2">
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    rows={2}
                    placeholder={composeMode === 'sms' ? 'Type a text...' : 'Write an email...'}
                    className="min-h-[58px] flex-1 resize-none rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2.5 text-sm text-[var(--ck-text)] placeholder:text-[var(--ck-text-dim)] outline-none focus:border-[#E32E2E]"
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || !message.trim() || (composeMode === 'sms' && phoneOptedOut)}
                    className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#E32E2E] text-white transition-colors hover:bg-[#C42626] disabled:cursor-not-allowed disabled:opacity-35"
                    title="Send"
                    aria-label="Send"
                  >
                    {sending ? <Icon name="progress_activity" size="text-lg" className="animate-spin" /> : <Icon name="send" size="text-lg" />}
                  </button>
                </div>
                {composeMode === 'sms' && (
                  <div className="flex flex-wrap items-center gap-2 px-5 pb-2 text-[10px] font-bold text-[var(--ck-text-dim)]">
                    <span className="rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1">
                      {messageMetric.encoding} - {messageMetric.characters} chars - {messageMetric.segments} segment{messageMetric.segments === 1 ? '' : 's'} - {messageMetric.remaining} left
                    </span>
                    {messageWarnings.map((warning) => (
                      <span key={warning} className="rounded-full border border-amber-400/35 bg-amber-400/10 px-2 py-1 text-amber-200">{warning}</span>
                    ))}
                  </div>
                )}
                {sendError && <p className="px-5 pb-3 text-xs font-bold text-[#ff7777]">{sendError}</p>}
              </footer>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--ck-text-muted)]">Select a conversation.</div>
          )}
        </main>

        <aside className="min-h-0 overflow-y-auto bg-[var(--ck-surface)] px-5 py-4">
          {activeThread ? (
            <SellerRail
              thread={activeThread}
              activities={activeActivities}
              agent={agent}
              phoneOptedOut={phoneOptedOut}
              tagOptions={tagOptions}
              onOpenLead={() => activeLeadId && router.push(`/leads/${activeLeadId}`)}
              onRefresh={() => {
                void loadActiveActivities()
                void loadThreads()
              }}
              onPhoneSuppressionChange={setPhoneOptedOut}
            />
          ) : (
            <p className="text-sm text-[var(--ck-text-muted)]">No seller selected.</p>
          )}
        </aside>
      </div>
        </>
      )}
        </div>
      </div>
    </section>
  )
}

function MissionControlBar({
  unreadCount,
  unansweredCount,
  remindersCount,
  noStatusCount,
  onOpen,
}: {
  unreadCount: number
  unansweredCount: number
  remindersCount: number
  noStatusCount: number
  onOpen: (filter: HubFilter) => void
}) {
  const items: Array<{ label: string; filter: HubFilter; count: number; icon: string; tone: string; help: string }> = [
    { label: 'Unread', filter: 'unread', count: unreadCount, icon: 'mail', tone: 'bg-[#5867E8]', help: 'Unread messages' },
    { label: 'Unanswered', filter: 'unanswered', count: unansweredCount, icon: 'hourglass_empty', tone: 'bg-[#2EA8E5]', help: 'Outbound texts waiting on an answer' },
    { label: 'Reminders', filter: 'reminders', count: remindersCount, icon: 'notifications', tone: 'bg-[#EF4D6D]', help: 'Follow-up reminders' },
    { label: 'No Status', filter: 'no_status', count: noStatusCount, icon: 'question_mark', tone: 'bg-[#F7B955]', help: 'Prospects with no status' },
  ]

  return (
    <div className="flex justify-center">
      <div className="inline-flex items-center gap-3 rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-4 py-2 shadow-sm">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => onOpen(item.filter)}
            className="group relative flex h-10 w-10 items-center justify-center rounded-full text-white shadow-sm transition-transform hover:-translate-y-0.5"
            title={`${item.label}: ${item.help}`}
          >
            <span className={`absolute inset-0 rounded-full ${item.tone}`} />
            <Icon name={item.icon} size="text-lg" className="relative z-10" />
            <span className="absolute -right-1 -top-1 z-20 min-w-5 rounded-full bg-[#6377FF] px-1.5 py-0.5 text-center text-[10px] font-black leading-none text-white ring-2 ring-[var(--ck-surface-elev)]">
              {item.count > 99 ? '99+' : item.count}
            </span>
            <span className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] z-30 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--ck-border)] bg-[var(--ck-surface)] px-2 py-1 text-[11px] font-bold text-[var(--ck-text)] shadow-lg group-hover:block">
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function HubSideNav({
  tabs,
  activeView,
  onViewChange,
}: {
  tabs: Array<{ id: HubView; label: string; icon: string }>
  activeView: HubView
  onViewChange: (view: HubView) => void
}) {
  return (
    <aside className="hidden border-r border-[var(--ck-border)] bg-[var(--ck-surface-elev)] py-3 lg:block">
      <nav className="flex flex-col items-center gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onViewChange(tab.id)}
            className={`group flex h-12 w-12 items-center justify-center rounded-xl transition-colors ${
              activeView === tab.id
                ? 'bg-[#E32E2E] text-white'
                : 'text-[var(--ck-text-dim)] hover:bg-white/[0.04] hover:text-[var(--ck-text)]'
            }`}
            title={tab.label}
            aria-label={tab.label}
          >
            <Icon name={tab.icon} size="text-xl" />
          </button>
        ))}
      </nav>
    </aside>
  )
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2.5 py-1">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--ck-text-dim)] hover:text-[var(--ck-text)]"
        aria-label={`Clear ${label}`}
      >
        <Icon name="close" size="text-xs" />
      </button>
    </span>
  )
}

function ThreadRowIndicators({ thread }: { thread: HubThread }) {
  const signals = threadRowSignals(thread).filter((signal) => signal.active)
  const visibleSignals = signals.slice(0, 3)
  const tagIds = threadTagIds(thread)
  const tags = tagIds.slice(0, 1).map((tagId, index) => conversationTagOption(tagId, index))
  const hiddenCount = Math.max(0, signals.length - visibleSignals.length) + Math.max(0, tagIds.length - tags.length)

  if (visibleSignals.length === 0 && tags.length === 0) return null

  return (
    <span className="mt-1 flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap">
      {visibleSignals.length > 0 && (
        <span className="flex shrink-0 items-center gap-1">
          {visibleSignals.map((signal) => (
            <span
              key={signal.id}
              title={signal.label}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-transparent text-[9px] text-white"
              style={{ background: signal.color }}
            >
              <Icon name={signal.icon} size="text-[10px]" filled />
            </span>
          ))}
        </span>
      )}
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex min-w-0 max-w-[76px] items-center gap-1 rounded-sm border border-[var(--ck-border)] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-bold leading-none text-[var(--ck-text-muted)]"
          title={tag.label}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tag.color }} />
          <span className="truncate">{conversationTagCompactLabel(tag.id)}</span>
        </span>
      ))}
      {hiddenCount > 0 && (
        <span
          className="shrink-0 rounded-sm border border-[var(--ck-border)] bg-white/[0.03] px-1 py-0.5 text-[9px] font-black leading-none text-[var(--ck-text-dim)]"
          title={`${hiddenCount} more row signals or tags`}
        >
          +{hiddenCount}
        </span>
      )}
    </span>
  )
}

function TagFilterDropdown({
  options,
  selectedTag,
  onSelect,
}: {
  options: ConversationTagOption[]
  selectedTag: string
  onSelect: (tag: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = selectedTag !== 'all' ? conversationTagOption(selectedTag) : null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-xs font-black uppercase tracking-wider text-[var(--ck-text)] transition-colors hover:border-[var(--ck-border-strong)]"
      >
        <span className="inline-flex min-w-0 items-center gap-2 truncate">
          {selected && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: selected.color }} />}
          <span className="truncate">{selected?.label || 'Tags'}</span>
        </span>
        <Icon name="expand_more" size="text-base" className={`shrink-0 text-[var(--ck-text-dim)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-56 overflow-hidden rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] shadow-xl">
          <button
            type="button"
            onClick={() => {
              onSelect('all')
              setOpen(false)
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold transition-colors hover:bg-white/[0.04] ${selectedTag === 'all' ? 'text-[var(--ck-text)]' : 'text-[var(--ck-text-muted)]'}`}
          >
            <span className="h-2.5 w-2.5 rounded-full border border-[var(--ck-border)]" />
            All Tags
          </button>
          <div className="max-h-72 overflow-y-auto py-1">
            {options.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => {
                  onSelect(tag.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold transition-colors hover:bg-white/[0.04] ${selectedTag === tag.id ? 'bg-white/[0.05] text-[var(--ck-text)]' : 'text-[var(--ck-text-muted)]'}`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tag.color }} />
                <span className="truncate">{tag.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function HubDashboard({
  totalThreads,
  unreadCount,
  unansweredCount,
  remindersCount,
  noStatusCount,
  replyMetric,
  campaignMetrics,
  textActivity,
  maxTextActivity,
  tagMetrics,
  leadBreakdown,
  onOpenInbox,
}: {
  totalThreads: number
  unreadCount: number
  unansweredCount: number
  remindersCount: number
  noStatusCount: number
  replyMetric: ReplyMetric
  campaignMetrics: CampaignMetric[]
  textActivity: Array<{ label: string; sent: number; replies: number }>
  maxTextActivity: number
  tagMetrics: TagMetric[]
  leadBreakdown: Array<{ label: string; value: number; color: string }>
  onOpenInbox: (filter: HubFilter) => void
}) {
  const leadTotal = Math.max(1, leadBreakdown.reduce((sum, item) => sum + item.value, 0))
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(420px,0.85fr)_minmax(0,1fr)_minmax(320px,0.85fr)]">
        <section className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
          <div className="mb-3 flex items-center gap-2">
            <p className="text-xs font-black uppercase tracking-widest text-[var(--ck-text-dim)]">What is On Your Plate</p>
            <Icon name="info" size="text-sm" className="text-[var(--ck-text-dim)]" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <PlateCard icon="mail" label="Unread" value={unreadCount} action="respond now" tone="bg-[#5867E8]" onClick={() => onOpenInbox('unread')} />
            <PlateCard icon="hourglass_empty" label="Unanswered" value={unansweredCount} action="reply now" tone="bg-[#2EA8E5]" onClick={() => onOpenInbox('unanswered')} />
            <PlateCard icon="notifications" label="Reminders" value={remindersCount} action="view reminders" tone="bg-[#EF4D6D]" onClick={() => onOpenInbox('reminders')} />
            <PlateCard icon="question_mark" label="No Status" value={noStatusCount} action="view inbox" tone="bg-[#F7B955]" onClick={() => onOpenInbox('no_status')} />
          </div>
        </section>

        <section className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Prospect Leads</p>
              <p className="mt-2 text-3xl font-black text-[var(--ck-text)]">{totalThreads.toLocaleString()}</p>
              <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Average reply time: {replyMetricLabel(replyMetric)}</p>
            </div>
            <div className="h-24 w-24 rounded-full border-[14px] border-[#7D9BFF]" style={{ borderTopColor: '#72D398', borderRightColor: '#F7B955', borderBottomColor: '#E32E2E' }} />
          </div>
          <div className="mt-4 grid gap-2">
            {leadBreakdown.map((item) => (
              <div key={item.label} className="grid grid-cols-[96px_minmax(0,1fr)_34px] items-center gap-2 text-xs">
                <span className="truncate text-[var(--ck-text-muted)]">{item.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-[var(--ck-surface)]">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(4, (item.value / leadTotal) * 100)}%`, background: item.color }} />
                </span>
                <span className="text-right font-bold text-[var(--ck-text)]">{item.value}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Lead Breakdown</p>
            <Icon name="donut_large" size="text-lg" className="text-[var(--ck-text-dim)]" />
          </div>
          <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-4">
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-[14px] border-[#7D9BFF] text-center text-xl font-black text-[var(--ck-text)]" style={{ borderTopColor: '#E32E2E', borderRightColor: '#F7B955', borderBottomColor: '#72D398' }}>
              {leadTotal}
            </div>
            <div className="space-y-2">
              {leadBreakdown.map((item) => (
                <div key={item.label} className="grid grid-cols-[10px_minmax(0,1fr)_34px] items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                  <span className="truncate text-[var(--ck-text-muted)]">{item.label}</span>
                  <span className="text-right font-bold text-[var(--ck-text)]">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(320px,0.8fr)]">
        <section className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Top Campaigns</p>
            <Icon name="campaign" size="text-lg" className="text-[var(--ck-text-dim)]" />
          </div>
          <div className="space-y-2">
            {campaignMetrics.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--ck-text-muted)]">No campaign activity yet.</p>
            ) : campaignMetrics.map((campaign) => (
              <div key={campaign.label} className="grid grid-cols-[minmax(0,1fr)_42px_42px_42px] gap-2 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 py-2 text-xs">
                <span className="truncate font-bold text-[var(--ck-text)]">{campaign.label}</span>
                <span className="text-right text-[var(--ck-text-muted)]">{campaign.sent}</span>
                <span className="text-right text-cyan-200">{campaign.replies}</span>
                <span className="text-right text-[var(--ck-text-dim)]">{formatPercent(campaign.replies, campaign.sent || campaign.active)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Text Activity</p>
              <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Sent vs. seller replies over the last 7 days.</p>
            </div>
            <Icon name="show_chart" size="text-lg" className="text-[var(--ck-text-dim)]" />
          </div>
          <div className="grid h-56 grid-cols-7 items-end gap-3 border-b border-[var(--ck-border)] pb-3">
            {textActivity.map((day) => (
              <div key={day.label} className="flex h-full flex-col justify-end gap-1">
                <span className="rounded-t bg-[#72D398]/70" style={{ height: `${Math.max(4, (day.replies / maxTextActivity) * 100)}%` }} title={`${day.replies} replies`} />
                <span className="rounded-t bg-[#7D9BFF]/70" style={{ height: `${Math.max(4, (day.sent / maxTextActivity) * 100)}%` }} title={`${day.sent} sent`} />
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-3 text-center text-[10px] font-bold uppercase text-[var(--ck-text-dim)]">
            {textActivity.map((day) => <span key={day.label}>{day.label}</span>)}
          </div>
        </section>

        <section className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Tags</p>
            <Icon name="sell" size="text-lg" className="text-[var(--ck-text-dim)]" />
          </div>
          <div className="space-y-2">
            {tagMetrics.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--ck-text-muted)]">No tag metrics yet.</p>
            ) : tagMetrics.map((tag) => (
              <div key={tag.label} className="grid grid-cols-[112px_minmax(0,1fr)_34px] items-center gap-2 text-xs">
                <span className="truncate text-[var(--ck-text-muted)]">{tag.label}</span>
                <span className="h-2 overflow-hidden rounded-full bg-[var(--ck-surface)]">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(8, (tag.count / Math.max(1, tagMetrics[0]?.count || 1)) * 100)}%`, background: tag.tone }} />
                </span>
                <span className="text-right font-bold text-[var(--ck-text)]">{tag.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function CampaignBuilder({
  draft,
  modalOpen,
  modalKind,
  metrics,
  trackerRows,
  templates,
  saving,
  status,
  onDraftChange,
  onSave,
  onOpenCreate,
  onCloseCreate,
  onOpenInbox,
  onOpenTemplates,
}: {
  draft: CampaignDraft
  modalOpen: boolean
  modalKind: 'initial' | 'follow_up'
  metrics: CampaignDraftMetrics
  trackerRows: CampaignTrackerRow[]
  templates: SmsTemplateRow[]
  saving: boolean
  status: string | null
  onDraftChange: (patch: Partial<CampaignDraft>) => void
  onSave: () => void
  onOpenCreate: (kind: 'initial' | 'follow_up') => void
  onCloseCreate: () => void
  onOpenInbox: (filter: HubFilter) => void
  onOpenTemplates: (category: TemplateCategory) => void
}) {
  const [tableSearch, setTableSearch] = useState('')
  const [tableFilter, setTableFilter] = useState<CampaignListKey | 'all'>('all')
  const topTemplate = templates[0]
  const visibleRows = trackerRows.filter((row) => {
    if (tableFilter !== 'all' && row.id !== tableFilter) return false
    const query = tableSearch.trim().toLowerCase()
    if (!query) return true
    return [row.label, row.description, templateCategoryLabel(row.templateCategory), row.status]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <section className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)]">
        <div className="flex flex-col gap-3 border-b border-[var(--ck-border)] px-4 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <p className="text-xl font-black text-[var(--ck-text)]">Campaigns</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ck-text-muted)]">Create, monitor, and follow up on prospecting campaigns.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onOpenCreate('initial')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#5867E8] px-4 py-2.5 text-xs font-black text-white transition-colors hover:bg-[#4655c9]"
            >
              <Icon name="add" size="text-base" /> Create New Campaign
            </button>
            <button
              type="button"
              onClick={() => onOpenCreate('follow_up')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#5867E8] px-4 py-2.5 text-xs font-black text-white transition-colors hover:bg-[#4655c9]"
            >
              <Icon name="event_repeat" size="text-base" /> Create Follow-up Campaign
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-[var(--ck-border)] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="w-full lg:max-w-[220px]">
            <span className="sr-only">Filter campaigns</span>
            <select
              value={tableFilter}
              onChange={(event) => setTableFilter(event.target.value as CampaignListKey | 'all')}
              className="h-10 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 text-xs font-black uppercase tracking-wider text-[var(--ck-text)]"
            >
              <option value="all">Filter</option>
              {CAMPAIGN_LIST_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <div className="relative w-full lg:max-w-[340px]">
            <Icon name="search" size="text-base" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ck-text-dim)]" />
            <input
              value={tableSearch}
              onChange={(event) => setTableSearch(event.target.value)}
              placeholder="Search campaigns"
              className="h-10 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] pl-9 pr-3 text-sm text-[var(--ck-text)] outline-none focus:border-[#5867E8]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-xs">
            <thead className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">
              <tr className="border-b border-[var(--ck-border)]">
                <th className="px-4 py-3">Campaign Name</th>
                <th className="px-3 py-3">Market</th>
                <th className="px-3 py-3 text-right">Audience</th>
                <th className="px-3 py-3 text-right">Sent</th>
                <th className="px-3 py-3 text-right">Replies</th>
                <th className="px-3 py-3 text-right">Needs Reply</th>
                <th className="px-3 py-3 text-right">Drip</th>
                <th className="px-3 py-3 text-right">Deliverability</th>
                <th className="px-3 py-3 text-right">Response</th>
                <th className="px-3 py-3 text-right">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-sm text-[var(--ck-text-muted)]">No campaigns match.</td>
                </tr>
              ) : visibleRows.map((row) => {
                const deliverability = row.sent > 0 ? Math.max(0, Math.round(((row.sent - row.suppressed) / row.sent) * 100)) : null
                return (
                  <tr key={row.id} className="border-b border-[var(--ck-border)] transition-colors hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onDraftChange({ listKey: row.id })}
                        className="max-w-[300px] text-left"
                      >
                        <span className="block truncate text-sm font-bold text-[var(--ck-text)]">{row.label}</span>
                        <span className="mt-1 block truncate text-[11px] text-[var(--ck-text-muted)]">{row.description}</span>
                      </button>
                    </td>
                    <td className="px-3 py-3 text-[var(--ck-text-muted)]">Kansas City</td>
                    <td className="px-3 py-3 text-right font-bold text-[var(--ck-text)]">{row.audience.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right text-[var(--ck-text-muted)]">{row.sent.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right text-emerald-200">{row.replies.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right text-cyan-200">{row.needsReply.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right text-blue-200">{row.dripReady.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right text-amber-200">{deliverability == null ? '--' : `${deliverability}%`}</td>
                    <td className="px-3 py-3 text-right text-amber-200">{Math.round(row.responseRate * 100)}%</td>
                    <td className="px-3 py-3 text-right text-[var(--ck-text-muted)]">{row.lastTouchAt ? new Date(row.lastTouchAt).toLocaleDateString('en-US') : '--'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          onDraftChange({ listKey: row.id, templateCategory: row.templateCategory })
                          onOpenInbox('all')
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ck-text-dim)] hover:bg-white/[0.04] hover:text-[var(--ck-text)]"
                        title="Open matching inbox"
                        aria-label="Open matching inbox"
                      >
                        <Icon name="more_vert" size="text-base" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {status && <p className={`text-xs font-bold ${status.startsWith('Saved') ? 'text-emerald-300' : 'text-[#ff7777]'}`}>{status}</p>}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 py-10 backdrop-blur-sm">
          <section className="w-full max-w-[720px] overflow-hidden rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] shadow-2xl">
            <header className="flex items-center justify-between border-b border-[var(--ck-border)] px-5 py-4">
              <p className="text-lg font-bold text-[var(--ck-text)]">{modalKind === 'follow_up' ? 'Create Follow-up Campaign' : 'Create New Campaign'}</p>
              <button
                type="button"
                onClick={onCloseCreate}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ck-text-dim)] hover:bg-white/[0.04] hover:text-[var(--ck-text)]"
                aria-label="Close"
              >
                <Icon name="close" size="text-base" />
              </button>
            </header>

            <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="grid gap-4">
                <label className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
                  <span className="text-sm font-semibold text-[var(--ck-text-muted)]">Enter Campaign Name</span>
                  <input
                    value={draft.name}
                    onChange={(event) => onDraftChange({ name: event.target.value })}
                    placeholder="Oct Dallas High Equity"
                    className="h-11 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#5867E8]"
                  />
                </label>
                <label className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
                  <span className="text-sm font-semibold text-[var(--ck-text-muted)]">Select Market</span>
                  <select
                    value={draft.market}
                    onChange={(event) => onDraftChange({ market: event.target.value })}
                    className="h-11 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#5867E8]"
                  >
                    {CAMPAIGN_MARKETS.map((market) => <option key={market} value={market}>{market}</option>)}
                  </select>
                </label>
                <label className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
                  <span className="text-sm font-semibold text-[var(--ck-text-muted)]">Call Forwarding Number</span>
                  <input
                    value={draft.callForwardingNumber}
                    onChange={(event) => onDraftChange({ callForwardingNumber: event.target.value })}
                    placeholder="(816) 307-7835"
                    className="h-11 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#5867E8]"
                  />
                </label>
                <label className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
                  <span className="text-sm font-semibold text-[var(--ck-text-muted)]">List Type</span>
                  <select
                    value={draft.listKey}
                    onChange={(event) => onDraftChange({ listKey: event.target.value as CampaignListKey })}
                    className="h-11 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#5867E8]"
                  >
                    {CAMPAIGN_LIST_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
                <label className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
                  <span className="text-sm font-semibold text-[var(--ck-text-muted)]">Template Type</span>
                  <select
                    value={draft.templateCategory}
                    onChange={(event) => onDraftChange({ templateCategory: event.target.value as TemplateCategory })}
                    className="h-11 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#5867E8]"
                  >
                    {TEMPLATE_CATEGORIES.map((category) => <option key={category} value={category}>{templateCategoryLabel(category)}</option>)}
                  </select>
                </label>
                <label className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
                  <span className="text-sm font-semibold text-[var(--ck-text-muted)]">Audience</span>
                  <select
                    value={draft.statusFilter}
                    onChange={(event) => onDraftChange({ statusFilter: event.target.value as CampaignStatusFilter })}
                    className="h-11 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#5867E8]"
                  >
                    {CAMPAIGN_STATUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
              </div>

              <aside className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Campaign Preview</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MiniMetric label="Audience" value={metrics.audience} />
                  <MiniMetric label="Days" value={metrics.batches} />
                  <MiniMetric label="Replies" value={metrics.replies} />
                  <MiniMetric label="Suppressed" value={metrics.suppressed} />
                </div>
                <div className="mt-4 rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">{templateCategoryLabel(draft.templateCategory)}</p>
                  <p className="mt-2 line-clamp-5 text-xs leading-relaxed text-[var(--ck-text-muted)]">
                    {topTemplate?.body || TEMPLATE_CATEGORY_HINTS[draft.templateCategory]}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenTemplates(draft.templateCategory)}
                  className="mt-3 w-full rounded-lg border border-[var(--ck-border)] px-3 py-2 text-xs font-black uppercase tracking-wider text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]"
                >
                  Manage Templates
                </button>
              </aside>
            </div>

            <footer className="flex justify-end gap-2 border-t border-[var(--ck-border)] px-5 py-4">
              <button
                type="button"
                onClick={onCloseCreate}
                className="rounded-lg border border-[var(--ck-border)] px-4 py-2 text-sm font-bold text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saving || draft.name.trim().length === 0}
                className="rounded-lg bg-[#5867E8] px-4 py-2 text-sm font-bold text-white hover:bg-[#4655c9] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface)] px-2 py-2 text-center">
      <p className="text-lg font-black leading-none text-[var(--ck-text)]">{value.toLocaleString()}</p>
      <p className="mt-1 text-[9px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">{label}</p>
    </div>
  )
}

function PlateCard({
  icon,
  label,
  value,
  action,
  tone,
  onClick,
}: {
  icon: string
  label: string
  value: number
  action: string
  tone: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 py-3 text-left transition-colors hover:border-[#E32E2E]/45"
    >
      <span className={`flex h-11 w-11 items-center justify-center rounded-full text-white ${tone}`}>
        <Icon name={icon} size="text-xl" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-black leading-none text-[var(--ck-text)]">{value.toLocaleString()}</span>
        <span className="mt-1 block text-sm font-bold text-[var(--ck-text)]">{label}</span>
        <span className="mt-0.5 block truncate text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-dim)]">{action}</span>
      </span>
    </button>
  )
}

function TemplateBuilder({
  templates,
  templateName,
  templateCategory,
  templateBody,
  templatePreview,
  variationCount,
  templateValidation,
  templateSaving,
  templateStatus,
  onNameChange,
  onCategoryChange,
  onBodyChange,
  onLoadTemplate,
  onSave,
}: {
  templates: SmsTemplateRow[]
  templateName: string
  templateCategory: TemplateCategory
  templateBody: string
  templatePreview: string
  variationCount: number
  templateValidation: ReturnType<typeof templateCompliance>
  templateSaving: boolean
  templateStatus: string | null
  onNameChange: (value: string) => void
  onCategoryChange: (value: TemplateCategory) => void
  onBodyChange: (value: string) => void
  onLoadTemplate: (template: SmsTemplateRow) => void
  onSave: () => void
}) {
  const canSave = templateName.trim().length > 0 && templateBody.trim().length > 0 && templateValidation.restricted.length === 0
  const filteredTemplates = templates.filter((template) => template.category === templateCategory)
  const templateTypeLabel = templateCategoryLabel(templateCategory)
  return (
    <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Template Name</span>
            <input
              value={templateName}
              onChange={(event) => onNameChange(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Template Type</span>
            <select
              value={templateCategory}
              onChange={(event) => onCategoryChange(event.target.value as TemplateCategory)}
              className="mt-2 h-11 w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 text-sm font-semibold text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
            >
              {TEMPLATE_CATEGORIES.map((category) => (
                <option key={category} value={category}>{templateCategoryLabel(category)}</option>
              ))}
            </select>
            <span className="mt-2 block text-[11px] font-semibold leading-snug text-[var(--ck-text-muted)]">
              {TEMPLATE_CATEGORY_HINTS[templateCategory]}
            </span>
          </label>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button type="button" className="rounded-lg bg-[#2787ff] px-3 py-1.5 text-xs font-black text-white">Best Practices</button>
              <button type="button" className="rounded-lg border border-[var(--ck-border)] px-3 py-1.5 text-xs font-bold text-[var(--ck-text-muted)]">Negative Keywords</button>
              <button
                type="button"
                onClick={() => onBodyChange(`${templateBody} Reply STOP to opt out.`)}
                className="rounded-lg border border-[var(--ck-border)] px-3 py-1.5 text-xs font-bold text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]"
              >
                Add opt-out line
              </button>
            </div>
            <textarea
              value={templateBody}
              onChange={(event) => onBodyChange(event.target.value)}
              rows={12}
              placeholder="Write your message. Use {firstName}, {propertyAddress}, and spinner groups like {considering|thinking about|open to}."
              className="w-full resize-none rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 py-3 text-sm leading-relaxed text-[var(--ck-text)] outline-none focus:border-[#E32E2E]"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--ck-text-dim)]">
              <span>{templateBody.length} characters</span>
              <span>{variationCount.toLocaleString()} variation{variationCount === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {['{firstName}', '{propertyAddress}', '{mailingAddress}', '{agentName}', '{companyName}'].map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => onBodyChange(`${templateBody}${templateBody.endsWith(' ') || templateBody.length === 0 ? '' : ' '}${token}`)}
                  className="rounded-lg border border-[var(--ck-border)] px-2.5 py-1 text-[11px] font-bold text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]"
                >
                  {token}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <ChecklistItem ok={templateBody.length >= 8} label="Minimum of 8 characters" />
            <ChecklistItem ok={!templateValidation.isLong} label="Clean SMS length" detail={templateValidation.isLong ? 'Over 320 characters' : undefined} />
            <ChecklistItem ok={templateValidation.restricted.length === 0} label="No restricted words" detail={templateValidation.restricted.join(', ')} />
            <ChecklistItem ok={templateValidation.negatives.length === 0} label="No negative keywords" detail={templateValidation.negatives.join(', ')} />
            <ChecklistItem ok={templateValidation.hasMerge} label="Uses at least one merge field" />
            <ChecklistItem ok={templateValidation.hasOptOut} label="Opt-out language present" />
            <div className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 py-2 text-xs font-bold text-[var(--ck-text-muted)]">
              Compliance score <span className="text-[var(--ck-text)]">{templateValidation.score}/4</span>
            </div>
            <div className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Preview</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--ck-text)]">{templatePreview || 'Preview will appear here.'}</p>
            </div>
            <button
              type="button"
              onClick={onSave}
              disabled={!canSave || templateSaving}
              className="w-full rounded-xl bg-[#E32E2E] px-4 py-3 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-[#C42626] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {templateSaving ? 'Saving...' : 'Save Template'}
            </button>
            {templateStatus && <p className={`text-xs font-bold ${templateStatus.includes('saved') ? 'text-emerald-300' : 'text-[#ff7777]'}`}>{templateStatus}</p>}
          </div>
        </div>
      </section>

      <aside className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-black uppercase tracking-widest text-[var(--ck-text-dim)]">{templateTypeLabel} Templates</p>
            <p className="mt-1 text-[11px] font-semibold text-[var(--ck-text-muted)]">{TEMPLATE_CATEGORY_HINTS[templateCategory]}</p>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--ck-border)] px-2 py-1 text-[10px] font-black text-[var(--ck-text-dim)]">
            {filteredTemplates.length}
          </span>
        </div>
        <div className="mt-3 max-h-[560px] space-y-2 overflow-y-auto pr-1">
          {filteredTemplates.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--ck-text-muted)]">No {templateTypeLabel.toLowerCase()} templates loaded.</p>
          ) : filteredTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onLoadTemplate(template)}
              className="w-full rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 py-3 text-left transition-colors hover:border-[#E32E2E]/45"
            >
              <span className="block truncate text-sm font-black text-[var(--ck-text)]">{templateDisplayName(template.name)}</span>
              <span className="mt-1 block truncate text-[11px] text-[var(--ck-text-muted)]">{templateCategoryLabel(template.category)} - used {(template.usage_count || 0).toLocaleString()} times</span>
              <span className="mt-2 line-clamp-2 block text-xs text-[var(--ck-text-dim)]">{template.body}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}

function ChecklistItem({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] px-3 py-2">
      <Icon name={ok ? 'check_circle' : 'error'} size="text-base" className={ok ? 'text-emerald-300' : 'text-[#ff7777]'} />
      <div className="min-w-0">
        <p className="text-xs font-bold text-[var(--ck-text)]">{label}</p>
        {detail && <p className="mt-0.5 break-words text-[10px] text-[var(--ck-text-dim)]">{detail}</p>}
      </div>
    </div>
  )
}

function ConversationEvent({
  activity,
  initials,
  phone,
  participantName,
}: {
  activity: HubActivity
  initials: string
  phone: string | null
  participantName: string | null
}) {
  const inbound = activityDirection(activity) === 'inbound'
  const body = activityBody(activity)
  const meta = activityMetadata(activity)
  const speakerName = activityHeirName(activity) || participantName || 'Seller'
  const smsRoute = isSmsActivity(activity) ? activitySmsRouteLabel(activity, phone) : null
  const smsFooterPhone = isSmsActivity(activity) ? activitySmsFooterPhone(activity, phone) : null
  const smsFooterName = inbound ? toProperCase(speakerName) : activity.agent || 'Saving KC'

  if (activity.activity_type === 'note' || activity.activity_type === 'status_change' || activity.activity_type === 'outcome' || activity.activity_type === 'appointment' || activity.activity_type === 'task') {
    const icon = activity.activity_type === 'note'
      ? 'edit_note'
      : activity.activity_type === 'appointment'
        ? 'event_available'
        : activity.activity_type === 'task'
          ? 'task_alt'
          : 'sync_alt'
    return (
      <div className="flex justify-center">
        <div className="max-w-[620px] rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-4 py-3 text-center shadow-sm">
          <p className="inline-flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">
            <Icon name={icon} size="text-base" />
            {activity.activity_type.replace(/_/g, ' ')}
          </p>
          <p className="mt-2 line-clamp-2 text-sm text-[var(--ck-text)]">{body || 'Activity logged'}</p>
          <p className="mt-2 text-[10px] text-[var(--ck-text-dim)]">{activity.agent || 'System'} - {fullTime(activity.created_at)}</p>
        </div>
      </div>
    )
  }

  if (activity.activity_type === 'call' || activity.activity_type === 'voicemail') {
    return (
      <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
        <div className="max-w-[520px] rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <span className={`flex h-9 w-9 items-center justify-center rounded-full ${inbound ? 'bg-cyan-500/20 text-cyan-200' : 'bg-[#E32E2E]/15 text-[#ff7777]'}`}>
              <Icon name={activity.activity_type === 'voicemail' ? 'voicemail' : inbound ? 'call_received' : 'call_made'} size="text-lg" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-[var(--ck-text)]">{inbound ? 'Inbound Call' : 'Outbound Call'}</p>
              <p className="mt-0.5 text-xs text-[var(--ck-text-muted)]">
                {formatPhone(activityPhone(activity, phone) || '') || 'Unknown number'} - {fullTime(activity.created_at)}
              </p>
            </div>
            <div className="w-36 rounded-lg bg-[var(--ck-surface)] px-3 py-2">
              <div className="h-1.5 rounded-full bg-[var(--ck-border)]">
                <div className="h-full w-1/3 rounded-full bg-[#E32E2E]" />
              </div>
              <p className="mt-1 text-center font-mono text-[10px] text-[var(--ck-text-dim)]">{durationLabel(meta.duration || meta.duration_seconds)}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (activity.activity_type === 'email') {
    return (
      <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
        <div className="max-w-[560px] rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-4 py-3">
          <p className="text-xs font-black uppercase tracking-wider text-[var(--ck-text-dim)]">{inbound ? 'Email received' : 'Email sent'}</p>
          <p className="mt-2 line-clamp-3 text-sm text-[var(--ck-text)]">{body || 'Email'}</p>
          <p className="mt-2 text-[10px] text-[var(--ck-text-dim)]">{fullTime(activity.created_at)}{activity.agent ? ` - ${activity.agent}` : ''}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
      <div className={`flex max-w-[74%] gap-2 ${inbound ? '' : 'flex-row-reverse'}`}>
        <span className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${inbound ? 'bg-cyan-500/20 text-cyan-100' : 'bg-emerald-500/20 text-emerald-100'}`}>
          {inbound ? initials : 'SK'}
        </span>
        <div>
          <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${inbound ? 'rounded-bl-md bg-[var(--ck-surface-elev)] text-[var(--ck-text)]' : 'rounded-br-md bg-[#2787ff] text-white'}`}>
            <p className="line-clamp-3 break-words">{body || '[empty message]'}</p>
          </div>
          <p className={`mt-1 max-w-full truncate px-1 text-[10px] text-[var(--ck-text-dim)] ${inbound ? 'text-left' : 'text-right'}`} title={smsRoute || undefined}>
            {smsFooterName} - {smsFooterPhone || 'Unknown number'} - {fullTime(activity.created_at)}
          </p>
        </div>
      </div>
    </div>
  )
}

function SellerRail({
  thread,
  activities,
  agent,
  phoneOptedOut,
  tagOptions,
  onOpenLead,
  onRefresh,
  onPhoneSuppressionChange,
}: {
  thread: HubThread
  activities: HubActivity[]
  agent: string
  phoneOptedOut: boolean
  tagOptions: ConversationTagOption[]
  onOpenLead: () => void
  onRefresh: () => void
  onPhoneSuppressionChange: (isSuppressed: boolean) => void
}) {
  const lead = thread.lead
  const [note, setNote] = useState('')
  const [savingAction, setSavingAction] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionTone, setActionTone] = useState<'success' | 'error' | null>(null)
  const [optimisticPhoneStatus, setOptimisticPhoneStatus] = useState<PhoneQualityStatus | null>(null)
  const [customTag, setCustomTag] = useState('')
  const loggedPhoneStatus = phoneStatusFromActivities(activities)
  const phoneStatus = optimisticPhoneStatus || (loggedPhoneStatus !== 'unknown' ? loggedPhoneStatus : phoneOptedOut ? 'dnc' : 'unknown')
  const currentTagIds = threadTagIds(thread)
  const mapHref = mapsUrl(lead)
  const zillowHref = zillowUrl(lead)
  const hasPhone = Boolean(thread.phone || lead?.phone)
  const heirName = threadHeirName(thread)
  const decedentName = threadDecedentName(thread)

  useEffect(() => {
    setOptimisticPhoneStatus(null)
  }, [thread.id, loggedPhoneStatus])

  async function handleAddNote() {
    const content = note.trim()
    if (!lead || !content || savingAction) return

    setSavingAction('note')
    setActionMessage(null)
    setActionTone(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.from('lead_activities').insert({
        lead_id: lead.id,
        activity_type: 'note',
        description: content,
        agent,
        metadata: {
          source: 'dialer_prospecting_hub',
          phone: thread.phone || lead.phone,
          prospect_phone_id: thread.prospectPhone?.id || undefined,
          heir_name: thread.prospectPhone?.contact_name || undefined,
          heir_relation: thread.prospectPhone?.relationship || undefined,
        },
      })
      if (error) throw new Error(error.message)

      fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: lead.id,
          activity: {
            type: 'note',
            disposition: 'note_added',
            notes: content,
            agent,
          },
        }),
      }).catch(() => {})

      setNote('')
      setActionMessage('Note saved.')
      setActionTone('success')
      onRefresh()
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Could not save note.')
      setActionTone('error')
    } finally {
      setSavingAction(null)
    }
  }

  async function handleLeadField(field: 'station' | 'priority', value: string) {
    if (!lead || savingAction || lead[field] === value) return

    setSavingAction(field)
    setActionMessage(null)
    setActionTone(null)
    try {
      const response = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lead.id, [field]: value }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || `Could not update ${field}.`)

      const supabase = createClient()
      const { error: activityError } = await supabase.from('lead_activities').insert({
        lead_id: lead.id,
        activity_type: 'status_change',
        description: `${field === 'station' ? 'Stage' : 'Priority'} changed from ${lead[field] || 'unset'} to ${value}`,
        agent,
        metadata: {
          source: 'dialer_prospecting_hub',
          phone: thread.phone || lead.phone,
          prospect_phone_id: thread.prospectPhone?.id || undefined,
          heir_name: thread.prospectPhone?.contact_name || undefined,
          heir_relation: thread.prospectPhone?.relationship || undefined,
          field,
          old_value: lead[field],
          new_value: value,
        },
      })
      if (activityError) throw new Error(`${field === 'station' ? 'Stage' : 'Priority'} updated, but the timeline note failed: ${activityError.message}`)

      setActionMessage(`${field === 'station' ? 'Stage' : 'Priority'} updated.`)
      setActionTone('success')
      onRefresh()
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : `Could not update ${field}.`)
      setActionTone('error')
    } finally {
      setSavingAction(null)
    }
  }

  async function handlePhoneAction(action: Exclude<PhoneQualityStatus, 'unknown'>) {
    const phone = thread.phone || lead?.phone
    if (!phone || savingAction) return

    setSavingAction(action)
    setActionMessage(null)
    setActionTone(null)
    try {
      const response = await fetch('/api/conversations/phone-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead?.id || null,
          phone,
          action,
          agent,
          source: 'dialer_prospecting_hub',
          prospectPhoneId: thread.prospectPhone?.id || undefined,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Could not update phone status.')
      setOptimisticPhoneStatus(action)
      setActionMessage(payload?.message || 'Phone status updated.')
      setActionTone('success')
      if (typeof payload?.smsSuppressed === 'boolean') onPhoneSuppressionChange(payload.smsSuppressed)
      else onPhoneSuppressionChange(SUPPRESSED_PHONE_STATUSES.has(action))
      onRefresh()
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Could not update phone status.')
      setActionTone('error')
    } finally {
      setSavingAction(null)
    }
  }

  async function handleTagAction(tagId: string, nextActive?: boolean) {
    const normalized = normalizeTagId(tagId)
    if (!normalized || savingAction) return
    const isActive = currentTagIds.includes(normalized)
    const shouldAdd = nextActive ?? !isActive
    const action: ThreadWorkflowAction = shouldAdd ? 'tag_added' : 'tag_removed'

    setSavingAction(`tag:${normalized}`)
    setActionMessage(null)
    setActionTone(null)
    try {
      const response = await fetch('/api/conversations/thread-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead?.id || thread.prospectPhone?.lead_id || null,
          phone: thread.phone || lead?.phone,
          action,
          tag: normalized,
          agent,
          source: 'dialer_prospecting_hub',
          prospectPhoneId: thread.prospectPhone?.id || undefined,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Could not update tag.')
      if (action === 'tag_added') setCustomTag('')
      setActionMessage(`${conversationTagLabel(normalized)} ${action === 'tag_added' ? 'tag added.' : 'tag removed.'}`)
      setActionTone('success')
      onRefresh()
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Could not update tag.')
      setActionTone('error')
    } finally {
      setSavingAction(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-cyan-500/20 text-2xl font-black text-cyan-100">
          {threadDisplayInitials(thread)}
        </div>
        <p className="mt-3 truncate text-lg font-black text-[var(--ck-text)]">{threadPrimaryTitle(thread)}</p>
        <p className="mt-1 text-xs font-semibold text-[var(--ck-text-muted)]">{threadSecondaryTitle(thread) || prospectLabel(thread.prospectPhone) || lead?.assigned_agent || 'Prospecting'}</p>
      </div>

      <div className="space-y-2 border-t border-[var(--ck-border)] pt-4">
        <RailLine icon="call" value={formatPhone(thread.phone || lead?.phone || '') || 'No phone'} />
        {heirName && <RailLine icon="person" value={threadPrimaryTitle(thread)} />}
        {decedentName && !sameName(decedentName, heirName) && (
          <RailLine icon="person_search" value={threadSecondaryTitle(thread) || ''} />
        )}
        <RailLine icon="mail" value={lead?.email || 'No email'} />
        <RailLine icon="location_on" value={leadPropertySummary(lead) || 'No property'} />
        <RailLine icon="sell" value={lead?.station ? lead.station.replace(/_/g, ' ') : 'No stage'} />
        <RailLine icon="verified" value={`Phone: ${PHONE_STATUS_LABELS[phoneStatus]}`} />
      </div>

      <div className="space-y-3 border-t border-[var(--ck-border)] pt-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Tags</p>
        <div className="flex flex-wrap gap-1.5">
          {currentTagIds.length === 0 ? (
            <span className="rounded-full border border-[var(--ck-border)] px-2 py-1 text-[10px] font-bold text-[var(--ck-text-dim)]">No tags</span>
          ) : currentTagIds.map((tag, index) => (
            <button
              key={tag}
              type="button"
              onClick={() => void handleTagAction(tag, false)}
              disabled={Boolean(savingAction)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-1 text-[10px] font-bold text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] disabled:cursor-not-allowed disabled:opacity-50"
              title={`Remove ${conversationTagLabel(tag)}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: conversationTagColor(tag, index) }} />
              {conversationTagLabel(tag)}
              <Icon name="close" size="text-xs" />
            </button>
          ))}
        </div>
        <div className="grid max-h-36 grid-cols-1 gap-1 overflow-y-auto pr-1">
          {tagOptions.slice(0, 10).map((tag) => {
            const active = currentTagIds.includes(tag.id)
            const busy = savingAction === `tag:${tag.id}`
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => void handleTagAction(tag.id)}
                disabled={Boolean(savingAction)}
                className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? 'border-[#2787ff]/45 bg-[#2787ff]/12 text-[var(--ck-text)]'
                    : 'border-[var(--ck-border)] text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'
                }`}
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tag.color }} />
                  <span className="truncate">{tag.label}</span>
                </span>
                <Icon name={busy ? 'progress_activity' : active ? 'check' : 'add'} size="text-sm" className={busy ? 'animate-spin' : ''} />
              </button>
            )
          })}
        </div>
        <div className="flex gap-2">
          <input
            value={customTag}
            onChange={(event) => setCustomTag(event.target.value)}
            placeholder="Custom tag"
            className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 text-xs font-semibold text-[var(--ck-text)] placeholder:text-[var(--ck-text-dim)] outline-none focus:border-[#2787ff]"
          />
          <button
            type="button"
            onClick={() => void handleTagAction(customTag, true)}
            disabled={!normalizeTagId(customTag) || Boolean(savingAction)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2787ff] text-white transition-colors hover:bg-[#126fe5] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Add custom tag"
            title="Add custom tag"
          >
            <Icon name="add" size="text-base" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-[var(--ck-border)] pt-4">
        {mapHref && (
          <a
            href={mapHref}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-[var(--ck-border)] px-3 py-2.5 text-center text-xs font-black uppercase tracking-wider text-[var(--ck-text-muted)] transition-colors hover:text-[var(--ck-text)]"
          >
            Maps
          </a>
        )}
        {zillowHref && (
          <a
            href={zillowHref}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-[var(--ck-border)] px-3 py-2.5 text-center text-xs font-black uppercase tracking-wider text-[var(--ck-text-muted)] transition-colors hover:text-[var(--ck-text)]"
          >
            Zillow
          </a>
        )}
        {lead && (
          <button
            type="button"
            onClick={onOpenLead}
            className="rounded-xl bg-[#2787ff] px-3 py-2.5 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-[#126fe5]"
          >
            Open Lead
          </button>
        )}
        {lead && (
          <a
            href={`/dialer?lead_ids=${lead.id}&return_to=/dialer`}
            className="rounded-xl bg-[#E32E2E] px-3 py-2.5 text-center text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-[#C42626]"
          >
            Start Dialer
          </a>
        )}
      </div>

      {lead && (
        <div className="space-y-3 border-t border-[var(--ck-border)] pt-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Lead Controls</p>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-dim)]">Stage</span>
            <select
              value={lead.station || 'new'}
              onChange={(event) => void handleLeadField('station', event.target.value)}
              disabled={Boolean(savingAction)}
              className="mt-1 h-9 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 text-xs font-semibold text-[var(--ck-text)]"
            >
              {STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ck-text-dim)]">Priority</span>
            <select
              value={lead.priority || 'normal'}
              onChange={(event) => void handleLeadField('priority', event.target.value)}
              disabled={Boolean(savingAction)}
              className="mt-1 h-9 w-full rounded-lg border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 text-xs font-semibold text-[var(--ck-text)]"
            >
              {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="space-y-3 border-t border-[var(--ck-border)] pt-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Phone Quality</p>
        <div className="grid grid-cols-2 gap-2">
          <PhoneActionButton label="Verify" icon="verified" active={phoneStatus === 'verified'} busy={savingAction === 'verified'} disabled={!hasPhone} onClick={() => void handlePhoneAction('verified')} />
          <PhoneActionButton label="Wrong #" icon="phone_disabled" active={phoneStatus === 'wrong_number'} busy={savingAction === 'wrong_number'} disabled={!hasPhone} onClick={() => void handlePhoneAction('wrong_number')} />
          <PhoneActionButton label="DNC" icon="block" active={phoneStatus === 'dnc'} busy={savingAction === 'dnc'} disabled={!hasPhone} onClick={() => void handlePhoneAction('dnc')} />
          <PhoneActionButton label="Spam" icon="report" active={phoneStatus === 'spam'} busy={savingAction === 'spam'} disabled={!hasPhone} onClick={() => void handlePhoneAction('spam')} />
          <PhoneActionButton label="Block" icon="person_off" active={phoneStatus === 'blocked'} busy={savingAction === 'blocked'} disabled={!hasPhone} onClick={() => void handlePhoneAction('blocked')} />
        </div>
      </div>

      {lead && (
        <div className="space-y-3 border-t border-[var(--ck-border)] pt-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Notes</p>
          {lead.notes && <p className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-xs text-[var(--ck-text-muted)]">{lead.notes}</p>}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Add seller note..."
            className="w-full resize-none rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-3 py-2 text-sm text-[var(--ck-text)] placeholder:text-[var(--ck-text-dim)] outline-none focus:border-[#E32E2E]"
          />
          <button
            type="button"
            onClick={() => void handleAddNote()}
            disabled={!note.trim() || savingAction === 'note'}
            className="w-full rounded-xl border border-[var(--ck-border)] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-[var(--ck-text-muted)] transition-colors hover:text-[var(--ck-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savingAction === 'note' ? 'Saving...' : 'Save Note'}
          </button>
        </div>
      )}

      {actionMessage && (
        <p className={`rounded-xl border px-3 py-2 text-xs font-bold ${
          actionTone === 'error'
            ? 'border-[#ff7777]/35 bg-[#ff7777]/10 text-[#ff9b9b]'
            : 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200'
        }`}>
          {actionMessage}
        </p>
      )}
    </div>
  )
}

function PhoneActionButton({
  label,
  icon,
  active,
  busy,
  disabled = false,
  onClick,
}: {
  label: string
  icon: string
  active: boolean
  busy: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`rounded-xl border px-2 py-2 text-[10px] font-black uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'border-[#E32E2E]/45 bg-[#E32E2E]/15 text-white'
          : 'border-[var(--ck-border)] text-[var(--ck-text-muted)] hover:text-[var(--ck-text)]'
      }`}
    >
      <span className="flex flex-col items-center gap-1">
        <Icon name={busy ? 'progress_activity' : icon} size="text-base" className={busy ? 'animate-spin' : ''} />
        {label}
      </span>
    </button>
  )
}

function RailLine({ icon, value }: { icon: string; value: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg px-1 py-2 text-sm text-[var(--ck-text-muted)]">
      <Icon name={icon} size="text-base" className="mt-0.5 text-[var(--ck-text-dim)]" />
      <span className="min-w-0 break-words">{value}</span>
    </div>
  )
}
