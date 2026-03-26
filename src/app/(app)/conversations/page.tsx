'use client'

import { useState } from 'react'
import { InboxSidebar, type ThreadPreview } from '@/components/conversations/inbox-sidebar'
import { ThreadView } from '@/components/conversations/thread-view'
import type { Message } from '@/components/conversations/message-bubble'

// --- Mock Data ---

const mockThreads: ThreadPreview[] = [
  {
    id: 'mt-1',
    name: 'Marcus H. Thorne',
    initials: 'MT',
    avatarBg: 'bg-slate-900',
    avatarText: 'text-white',
    address: '1242 Oak Ridge Dr.',
    personality: 'assertive',
    tags: [{ label: 'Hot Lead', variant: 'hot' }],
    lastMessage: 'I need the contract sent by EOD tomorrow or...',
    timestamp: '10:15 AM',
    unread: true,
    starred: true,
  },
  {
    id: 'er-1',
    name: 'Elena Rodriguez',
    initials: 'ER',
    avatarBg: 'bg-slate-300',
    avatarText: 'text-slate-800',
    address: '7820 W 85th Terr',
    personality: 'analytical',
    tags: [],
    lastMessage: "Thanks for the information. I'll discuss it with my attorney.",
    timestamp: 'Yesterday',
    unread: false,
  },
  {
    id: 'jc-1',
    name: 'Jameson Cook',
    initials: 'JC',
    avatarBg: 'bg-slate-300',
    avatarText: 'text-slate-800',
    address: '301 N 10th St.',
    personality: 'amiable',
    tags: [],
    lastMessage: 'Missed call - (02:44)',
    timestamp: 'Mar 22',
    unread: false,
  },
]

const mockContact = {
  name: 'Marcus H. Thorne',
  initials: 'MT',
  address: '1242 Oak Ridge Dr, Kansas City, MO',
  county: 'Jackson County',
  tags: ['Pre-foreclosure', 'Heirship'],
  verified: true,
}

const mockDateGroups = [
  {
    label: 'March 21, 2026',
    messages: [
      {
        id: 'msg-1',
        type: 'email' as const,
        direction: 'sent' as const,
        subject: 'Subject: Offer Summary - 1242 Oak Ridge',
        emailMeta: 'Sent via Outbound Sales Server',
        content:
          "Dear Marcus, following our conversation this afternoon, I've outlined the cash offer of $245,000 for the property. This includes us covering all closing costs and requiring no repairs...",
        timestamp: '04:12 PM',
        senderInitials: 'ED',
      },
      {
        id: 'msg-2',
        type: 'sms' as const,
        direction: 'received' as const,
        content:
          'Hey, I got your email. $245k is a bit lower than I was hoping for given the recent renovations in the kitchen. Can we jump on a quick call tomorrow?',
        timestamp: '06:45 PM',
        senderInitials: 'MT',
      },
    ] satisfies Message[],
  },
  {
    label: 'Today',
    messages: [
      {
        id: 'msg-3',
        type: 'call' as const,
        direction: 'sent' as const,
        content: '',
        callDuration: '5m 12s',
        timestamp: 'Mar 22, 10:15 AM',
        senderInitials: 'ED',
      },
      {
        id: 'msg-4',
        type: 'sms' as const,
        direction: 'sent' as const,
        content:
          "No problem, Marcus. I'm reviewing those kitchen comps now. Let's touch base at 10 AM?",
        timestamp: '10:20 AM',
        senderInitials: 'ED',
      },
      {
        id: 'msg-5',
        type: 'sms' as const,
        direction: 'received' as const,
        content:
          "I need the contract sent by EOD tomorrow or I'm going to look at another buyer who came by today.",
        timestamp: '10:25 AM',
        senderInitials: 'MT',
      },
    ] satisfies Message[],
  },
]

export default function ConversationsPage() {
  const [activeThread, setActiveThread] = useState('mt-1')

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <InboxSidebar
        threads={mockThreads}
        activeThreadId={activeThread}
        onSelectThread={setActiveThread}
      />
      <ThreadView contact={mockContact} dateGroups={mockDateGroups} />
    </div>
  )
}
