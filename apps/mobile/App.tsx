import { StatusBar } from 'expo-status-bar'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { getMissingConfig } from './src/config'
import { fetchConversationDetail, fetchConversations, fetchLeadDetail, fetchLeads, fetchMobileSession, logCallEvent, sendMobileMessage } from './src/lib/api'
import { enqueueCallEvent, flushCallOutbox, getQueuedCallEvents } from './src/lib/call-outbox'
import { registerTwilioVoice, startTwilioVoiceCall, type IncomingVoiceCall, type NativeVoiceCall, type VoiceState } from './src/lib/twilio-voice-service'
import { getSupabaseClient } from './src/lib/supabase'
import type { CallOutcome, ConversationThread, CrmActivity, CrmLead } from './src/types'

const queryClient = new QueryClient()

function phoneKey(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, '') ?? ''
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MobileCrm />
    </QueryClientProvider>
  )
}

function MobileCrm() {
  const missingConfig = useMemo(() => getMissingConfig(), [])
  const supabase = useMemo(() => getSupabaseClient(), [])
  const [session, setSession] = useState<Session | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoadingSession(false)
      return
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session)
      })
      .catch(() => {
        setSession(null)
      })
      .finally(() => {
        setLoadingSession(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  if (missingConfig.length > 0) {
    return <SetupScreen missingConfig={missingConfig} />
  }

  if (loadingSession) {
    return <CenteredStatus label="Checking session..." />
  }

  if (!supabase || !session) {
    return <LoginScreen />
  }

  return <MobileWorkspace accessToken={session.access_token} email={session.user.email ?? 'Agent'} />
}

function SetupScreen({ missingConfig }: { missingConfig: string[] }) {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>SavingKC Mobile</Text>
        <Text style={styles.title}>Configuration needed</Text>
        <Text style={styles.body}>
          Add these values to apps/mobile/.env before running the app.
        </Text>
      </View>
      <View style={styles.panel}>
        {missingConfig.map((key) => (
          <Text key={key} style={styles.mono}>
            {key}
          </Text>
        ))}
      </View>
    </SafeAreaView>
  )
}

function LoginScreen() {
  const supabase = getSupabaseClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    if (!supabase || submitting) return
    setSubmitting(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (signInError) setError(signInError.message)
    setSubmitting(false)
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>SavingKC Mobile</Text>
        <Text style={styles.title}>Sign in</Text>
        <Text style={styles.body}>Use your CRM account to open your mobile call queue.</Text>
      </View>
      <View style={styles.form}>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Email"
          style={styles.input}
          value={email}
        />
        <TextInput
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          style={styles.input}
          value={password}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable disabled={submitting} onPress={signIn} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{submitting ? 'Signing in...' : 'Sign in'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

type MobileTab = 'contacts' | 'conversations' | 'phone'

function MobileWorkspace({ accessToken, email }: { accessToken: string; email: string }) {
  const supabase = getSupabaseClient()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<MobileTab>('contacts')
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [queuedEvents, setQueuedEvents] = useState(0)
  const [syncingOutbox, setSyncingOutbox] = useState(false)
  const [search, setSearch] = useState('')
  const [voiceState, setVoiceState] = useState<VoiceState>('offline')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceIdentity, setVoiceIdentity] = useState<{ callerId: string; displayName: string } | null>(null)
  const [incomingCall, setIncomingCall] = useState<IncomingVoiceCall | null>(null)
  const [activeVoiceCall, setActiveVoiceCall] = useState<NativeVoiceCall | null>(null)
  const leadsQuery = useQuery({
    queryKey: ['leads'],
    queryFn: ({ signal }) => fetchLeads({ accessToken, signal }),
  })
  const sessionQuery = useQuery({
    queryKey: ['mobile-session'],
    queryFn: ({ signal }) => fetchMobileSession({ accessToken, signal }),
  })

  useEffect(() => {
    refreshOutboxCount()
  }, [])

  useEffect(() => {
    let alive = true
    let registering = false
    async function registerPhone() {
      if (registering) return
      registering = true
      try {
        const identity = await registerTwilioVoice({
          accessToken,
          onState: (state) => { if (alive) setVoiceState(state) },
          onIncoming: (call) => { if (alive) setIncomingCall(call) },
        })
        if (alive) {
          setVoiceIdentity(identity)
          setVoiceError(null)
        }
      } catch (error) {
        if (alive) {
          setVoiceState('error')
          setVoiceError(error instanceof Error ? error.message : 'Phone registration failed.')
        }
      } finally {
        registering = false
      }
    }
    void registerPhone()
    const tokenRefresh = setInterval(() => void registerPhone(), 3_000_000)
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void registerPhone()
    })
    return () => {
      alive = false
      clearInterval(tokenRefresh)
      appStateSubscription.remove()
    }
  }, [accessToken])

  useEffect(() => activeVoiceCall?.onEnded(() => setActiveVoiceCall(null)), [activeVoiceCall])

  async function refreshOutboxCount() {
    const items = await getQueuedCallEvents()
    setQueuedEvents(items.length)
  }

  async function syncOutbox() {
    if (syncingOutbox) return
    setSyncingOutbox(true)
    await flushCallOutbox()
    await refreshOutboxCount()
    setSyncingOutbox(false)
  }

  async function signOut() {
    await supabase?.auth.signOut()
    queryClient.clear()
  }

  if (selectedLeadId) {
    return (
      <LeadDetailScreen
        accessToken={accessToken}
        leadId={selectedLeadId}
        onBack={() => setSelectedLeadId(null)}
        onOutboxChange={refreshOutboxCount}
      />
    )
  }

  if (selectedConversationId) {
    return <ConversationDetailScreen accessToken={accessToken} leadId={selectedConversationId} onBack={() => setSelectedConversationId(null)} />
  }

  const normalizedSearch = search.trim().toLowerCase()
  const filteredLeads = (leadsQuery.data ?? []).filter((lead) => !normalizedSearch || [lead.full_name, lead.phone, lead.email, lead.property_address, lead.city].some((value) => value?.toLowerCase().includes(normalizedSearch)))

  async function acceptIncomingCall() {
    if (!incomingCall) return
    try {
      const call = await incomingCall.accept()
      setActiveVoiceCall(call)
      setIncomingCall(null)
      setActiveTab('phone')
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Incoming call could not be answered.')
    }
  }

  async function rejectIncomingCall() {
    if (!incomingCall) return
    await incomingCall.reject().catch(() => null)
    setIncomingCall(null)
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.toolbar}>
        <View>
          <Text style={styles.eyebrow}>Signed in</Text>
          <Text style={styles.toolbarTitle}>{email}</Text>
        </View>
        <Pressable onPress={signOut} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </Pressable>
      </View>

      {incomingCall ? <View style={styles.incomingBanner}><View style={{ flex: 1 }}><Text style={styles.incomingTitle}>Incoming call</Text><Text style={styles.incomingNumber}>{incomingCall.from}</Text></View><Pressable onPress={rejectIncomingCall} style={styles.declineButton}><Text style={styles.primaryButtonText}>Decline</Text></Pressable><Pressable onPress={acceptIncomingCall} style={styles.answerButton}><Text style={styles.primaryButtonText}>Answer</Text></Pressable></View> : null}

      <View style={styles.mobileTabs}>
        {(['contacts', 'conversations', 'phone'] as MobileTab[]).map((tab) => <Pressable key={tab} onPress={() => setActiveTab(tab)} style={[styles.mobileTab, activeTab === tab && styles.mobileTabActive]}><Text style={[styles.mobileTabText, activeTab === tab && styles.mobileTabTextActive]}>{tab === 'contacts' ? 'Contacts' : tab === 'conversations' ? 'Conversations' : 'Phone'}</Text></Pressable>)}
      </View>

      {queuedEvents > 0 ? (
        <View style={styles.syncBanner}>
          <Text style={styles.syncText}>
            {queuedEvents} call event{queuedEvents === 1 ? '' : 's'} waiting to sync
          </Text>
          <Pressable onPress={syncOutbox} style={styles.syncButton}>
            <Text style={styles.syncButtonText}>{syncingOutbox ? 'Syncing' : 'Sync'}</Text>
          </Pressable>
        </View>
      ) : null}

      {activeTab === 'contacts' ? <>
      <View style={styles.headerCompact}>
        <Text style={styles.title}>Contacts</Text>
        <Text style={styles.body}>Active acquisition contacts. Dead records stay in the web archive.</Text>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search name, phone, email, or property" style={styles.input} autoCapitalize="none" />
      </View>
      {leadsQuery.isLoading ? (
        <CenteredStatus label="Loading leads..." />
      ) : leadsQuery.isError ? (
        <View style={styles.panel}>
          <Text style={styles.error}>{leadsQuery.error.message}</Text>
          <Pressable onPress={() => leadsQuery.refetch()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={filteredLeads}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <LeadRow lead={item} onOpen={() => setSelectedLeadId(item.id)} />}
          refreshing={leadsQuery.isFetching}
          onRefresh={() => leadsQuery.refetch()}
        />
      )}</> : activeTab === 'conversations' ? <ConversationsScreen accessToken={accessToken} onOpen={setSelectedConversationId} /> : <PhoneScreen accessToken={accessToken} callerId={voiceIdentity?.callerId ?? null} agentName={voiceIdentity?.displayName ?? email} voiceState={voiceState} error={voiceError || (sessionQuery.isError ? 'Mobile API session check failed.' : null)} activeCall={activeVoiceCall} onActiveCall={setActiveVoiceCall} />}
    </SafeAreaView>
  )
}

function ConversationsScreen({ accessToken, onOpen }: { accessToken: string; onOpen: (id: string) => void }) {
  const conversationsQuery = useQuery({
    queryKey: ['mobile-conversations'],
    queryFn: ({ signal }) => fetchConversations({ accessToken, signal }),
  })

  if (conversationsQuery.isLoading) return <CenteredStatus label="Loading conversations..." />
  if (conversationsQuery.isError) return <View style={styles.panel}><Text style={styles.error}>{conversationsQuery.error.message}</Text><Pressable onPress={() => conversationsQuery.refetch()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Retry</Text></Pressable></View>

  return <FlatList
    contentContainerStyle={styles.list}
    data={conversationsQuery.data}
    keyExtractor={(item) => item.id}
    onRefresh={() => conversationsQuery.refetch()}
    refreshing={conversationsQuery.isFetching}
    ListHeaderComponent={<View style={styles.headerCompact}><Text style={styles.title}>Conversations</Text><Text style={styles.body}>Needs reply is outcome-aware and active work is shown first.</Text></View>}
    renderItem={({ item }) => <ConversationRow thread={item} onOpen={() => onOpen(item.id)} />}
  />
}

function ConversationRow({ thread, onOpen }: { thread: ConversationThread; onOpen: () => void }) {
  return <Pressable onPress={onOpen} style={[styles.leadRow, thread.attentionState === 'needs_reply' && styles.needsReplyRow]}>
    <View style={styles.leadRowTop}><Text style={styles.leadName}>{thread.full_name || thread.phone || 'Unnamed contact'}</Text>{thread.attentionState === 'needs_reply' ? <Text style={styles.replyBadge}>Needs reply</Text> : null}</View>
    <Text style={styles.leadMeta}>{thread.lastMessage}</Text>
    <View style={styles.conversationMeta}><Text style={styles.activityDate}>{thread.lastChannel || 'No channel'}</Text><Text style={styles.activityDate}>{thread.owner || 'Unassigned'}</Text><Text style={styles.activityDate}>{new Date(thread.lastActivityAt).toLocaleString()}</Text></View>
  </Pressable>
}

function ConversationDetailScreen({ accessToken, leadId, onBack }: { accessToken: string; leadId: string; onBack: () => void }) {
  const queryClient = useQueryClient()
  const [channel, setChannel] = useState<'sms' | 'email'>('sms')
  const [message, setMessage] = useState('')
  const [subject, setSubject] = useState('')
  const [sending, setSending] = useState(false)
  const [sendStatus, setSendStatus] = useState<string | null>(null)
  const detailQuery = useQuery({
    queryKey: ['mobile-conversation', leadId],
    queryFn: ({ signal }) => fetchConversationDetail(leadId, { accessToken, signal }),
  })
  const contact = detailQuery.data?.contact
  const activities = detailQuery.data?.activities ?? []

  async function send() {
    if (!message.trim() || sending) return
    setSending(true)
    setSendStatus(null)
    try {
      await sendMobileMessage({ accessToken, leadId, channel, body: message.trim(), subject: subject.trim() || undefined })
      setMessage('')
      setSubject('')
      setSendStatus(channel === 'sms' ? 'Text sent.' : 'Email sent.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mobile-conversation', leadId] }),
        queryClient.invalidateQueries({ queryKey: ['mobile-conversations'] }),
      ])
    } catch (error) {
      setSendStatus(error instanceof Error ? error.message : 'Message could not be sent.')
    } finally {
      setSending(false)
    }
  }

  return <SafeAreaView style={styles.screen}>
    <StatusBar style="dark" />
    <View style={styles.toolbar}><Pressable onPress={onBack} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Back</Text></Pressable><Text style={styles.toolbarTitle}>{contact?.full_name || contact?.phone || 'Conversation'}</Text><Pressable onPress={() => detailQuery.refetch()} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Refresh</Text></Pressable></View>
    {detailQuery.isLoading ? <CenteredStatus label="Loading conversation..." /> : detailQuery.isError ? <View style={styles.panel}><Text style={styles.error}>{detailQuery.error.message}</Text></View> : <ScrollView contentContainerStyle={styles.detailContent}>
      <View style={styles.panel}><Text style={styles.sectionTitle}>{contact?.full_name || 'Unnamed contact'}</Text><Text style={styles.leadMeta}>{contact?.phone || 'No phone'}</Text><Text style={styles.leadMeta}>{contact?.email || 'No email'}</Text></View>
      <View style={styles.channelTabs}><Pressable onPress={() => setChannel('sms')} style={[styles.channelTab, channel === 'sms' && styles.channelTabActive]}><Text style={[styles.channelTabText, channel === 'sms' && styles.channelTabTextActive]}>Text</Text></Pressable><Pressable onPress={() => setChannel('email')} style={[styles.channelTab, channel === 'email' && styles.channelTabActive]}><Text style={[styles.channelTabText, channel === 'email' && styles.channelTabTextActive]}>Email</Text></Pressable></View>
      {channel === 'email' ? <TextInput value={subject} onChangeText={setSubject} placeholder="Subject" style={styles.input} /> : null}
      <TextInput value={message} onChangeText={setMessage} multiline placeholder={channel === 'sms' ? 'Write a text message…' : 'Write an email…'} style={[styles.input, styles.textArea]} />
      {sendStatus ? <Text style={sendStatus.includes('sent') ? styles.success : styles.error}>{sendStatus}</Text> : null}
      <Pressable disabled={sending || !message.trim() || (channel === 'sms' ? !contact?.phone : !contact?.email)} onPress={send} style={[styles.primaryButton, (sending || !message.trim() || (channel === 'sms' ? !contact?.phone : !contact?.email)) && styles.disabledButton]}><Text style={styles.primaryButtonText}>{sending ? 'Sending…' : channel === 'sms' ? 'Send text' : 'Send email'}</Text></Pressable>
      <View style={styles.panel}><Text style={styles.sectionTitle}>Recent communication</Text>{activities.length ? activities.map((activity) => <ActivityRow key={activity.id} activity={activity} />) : <Text style={styles.leadMeta}>No communication yet.</Text>}</View>
    </ScrollView>}
  </SafeAreaView>
}

function PhoneScreen({ accessToken, callerId, agentName, voiceState, error, activeCall, onActiveCall }: { accessToken: string; callerId: string | null; agentName: string; voiceState: VoiceState; error: string | null; activeCall: NativeVoiceCall | null; onActiveCall: (call: NativeVoiceCall | null) => void }) {
  const [phone, setPhone] = useState('')
  const [callError, setCallError] = useState<string | null>(null)
  const [currentState, setCurrentState] = useState<VoiceState>(voiceState)

  useEffect(() => setCurrentState(voiceState), [voiceState])

  async function placeCall() {
    if (!phone.trim() || activeCall) return
    setCallError(null)
    try {
      const call = await startTwilioVoiceCall({ accessToken, phone, onState: setCurrentState })
      onActiveCall(call)
    } catch (caught) {
      setCallError(caught instanceof Error ? caught.message : 'Call could not be started.')
      setCurrentState('ready')
    }
  }

  async function hangUp() {
    await activeCall?.disconnect().catch(() => null)
    onActiveCall(null)
    setCurrentState('ready')
  }

  return <ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">
    <View style={styles.headerCompact}><Text style={styles.title}>Phone</Text><Text style={styles.body}>Signed in as {agentName}. {currentState === 'ready' ? 'Ready for inbound and outbound calls.' : `Phone status: ${currentState}.`}</Text></View>
    <View style={styles.phoneCard}>
      <Text style={styles.eyebrow}>Calling from</Text><Text style={styles.phoneIdentity}>{callerId || 'Registering line…'}</Text>
      <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Enter phone number" style={styles.dialInput} editable={!activeCall} />
      {error || callError ? <Text style={styles.error}>{callError || error}</Text> : null}
      {activeCall ? <Pressable onPress={hangUp} style={styles.hangupButton}><Text style={styles.primaryButtonText}>End call</Text></Pressable> : <Pressable disabled={!phone.trim() || currentState !== 'ready'} onPress={placeCall} style={[styles.answerButton, (!phone.trim() || currentState !== 'ready') && styles.disabledButton]}><Text style={styles.primaryButtonText}>Call</Text></Pressable>}
    </View>
  </ScrollView>
}

function LeadRow({ lead, onOpen }: { lead: CrmLead; onOpen: () => void }) {
  const location = [lead.city, lead.state].filter(Boolean).join(', ')

  return (
    <View style={styles.leadRow}>
      <View style={styles.leadRowTop}>
        <Text style={styles.leadName}>{lead.full_name || 'Unnamed lead'}</Text>
        {lead.priority ? <Text style={styles.badge}>{lead.priority}</Text> : null}
      </View>
      <Text style={styles.leadMeta}>{lead.property_address || location || 'No address yet'}</Text>
      <Text style={styles.leadMeta}>{lead.phone || lead.email || 'No contact info'}</Text>
      <View style={styles.leadActions}>
        <Pressable disabled={!lead.phone} onPress={onOpen} style={[styles.callButton, !lead.phone && styles.disabledButton]}>
          <Text style={styles.callButtonText}>Call</Text>
        </Pressable>
        <Pressable onPress={onOpen} style={styles.noteButton}>
          <Text style={styles.noteButtonText}>Details</Text>
        </Pressable>
      </View>
    </View>
  )
}

function LeadDetailScreen({
  accessToken,
  leadId,
  onBack,
  onOutboxChange,
}: {
  accessToken: string
  leadId: string
  onBack: () => void
  onOutboxChange: () => void
}) {
  const queryClient = useQueryClient()
  const [activeCall, setActiveCall] = useState<{ phone: string; startedAt: number; clientCallId: string; voiceCall: NativeVoiceCall } | null>(null)
  const [outcome, setOutcome] = useState<CallOutcome>('connected')
  const [disposition, setDisposition] = useState('')
  const [callError, setCallError] = useState<string | null>(null)
  const [savingCall, setSavingCall] = useState(false)
  const detailQuery = useQuery({
    queryKey: ['lead-detail', leadId],
    queryFn: ({ signal }) => fetchLeadDetail(leadId, { accessToken, signal }),
  })

  const lead = detailQuery.data?.lead
  const activities = detailQuery.data?.activities || []

  async function startCall() {
    if (!lead?.phone || activeCall) return
    setCallError(null)
    const clientCallId = `${Date.now()}-${lead.id}`
    try {
      const queuedEvents = await getQueuedCallEvents()
      const locallyBlocked = queuedEvents.some((event) => (
        event.event === 'ended'
        && phoneKey(event.phone) === phoneKey(lead.phone)
        && (event.outcome === 'bad_number' || ['bad_number', 'wrong_number', 'disconnected', 'dnc'].includes(event.disposition || ''))
      ))
      if (locallyBlocked) {
        throw new Error('This number has an unsynced stop outcome and cannot be called again.')
      }
      const voiceCall = await startTwilioVoiceCall({
        accessToken,
        phone: lead.phone,
        contactName: lead.full_name,
        leadId: lead.id,
        clientAttemptId: clientCallId,
        onState: () => {},
      })
      const startEvent = {
        accessToken,
        leadId: lead.id,
        phone: lead.phone,
        event: 'started',
        clientCallId,
      } as const
      try {
        await logCallEvent(startEvent)
      } catch {
        await enqueueCallEvent(startEvent)
        onOutboxChange()
      }
      setActiveCall({ phone: lead.phone, startedAt: Date.now(), clientCallId, voiceCall })
    } catch (error) {
      setCallError(error instanceof Error ? error.message : 'Call could not be started.')
    }
  }

  async function saveCallOutcome() {
    if (!lead || !activeCall || savingCall) return
    setSavingCall(true)
    setCallError(null)
    try {
      const durationSeconds = Math.max(0, Math.round((Date.now() - activeCall.startedAt) / 1000))
      const eventPayload = {
        accessToken,
        leadId: lead.id,
        phone: activeCall.phone,
        event: 'ended',
        durationSeconds,
        outcome,
        disposition: disposition.trim() || outcome,
        clientCallId: activeCall.clientCallId,
      } as const
      try {
        await logCallEvent(eventPayload)
      } catch {
        await enqueueCallEvent(eventPayload)
        onOutboxChange()
      }
      await activeCall.voiceCall.disconnect().catch(() => null)
      setActiveCall(null)
      setDisposition('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lead-detail', lead.id] }),
        queryClient.invalidateQueries({ queryKey: ['leads'] }),
      ])
    } catch (error) {
      setCallError(error instanceof Error ? error.message : 'Unable to save call outcome.')
    } finally {
      setSavingCall(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.toolbar}>
        <Pressable onPress={onBack} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
        <Pressable onPress={() => detailQuery.refetch()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Refresh</Text>
        </Pressable>
      </View>

      {detailQuery.isLoading ? (
        <CenteredStatus label="Loading lead..." />
      ) : detailQuery.isError ? (
        <View style={styles.panel}>
          <Text style={styles.error}>{detailQuery.error.message}</Text>
          <Pressable onPress={() => detailQuery.refetch()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : lead ? (
        <ScrollView contentContainerStyle={styles.detailContent}>
          <View style={styles.headerCompact}>
            <Text style={styles.eyebrow}>{lead.priority || lead.station || 'Lead'}</Text>
            <Text style={styles.title}>{lead.full_name || 'Unnamed lead'}</Text>
            <Text style={styles.body}>{lead.property_address || formatLocation(lead) || 'No address yet'}</Text>
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Contact</Text>
            <Text style={styles.leadMeta}>{lead.phone || 'No phone'}</Text>
            <Text style={styles.leadMeta}>{lead.email || 'No email'}</Text>
            <Pressable disabled={!lead.phone || !!activeCall} onPress={startCall} style={[styles.primaryButton, (!lead.phone || !!activeCall) && styles.disabledButton]}>
              <Text style={styles.primaryButtonText}>{activeCall ? 'Call in progress' : 'Start call'}</Text>
            </Pressable>
          </View>

          {activeCall ? (
            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Call outcome</Text>
              <View style={styles.outcomeGrid}>
                {(['connected', 'voicemail', 'missed', 'busy', 'bad_number'] as CallOutcome[]).map((item) => (
                  <Pressable
                    key={item}
                    onPress={() => setOutcome(item)}
                    style={[styles.outcomeButton, outcome === item && styles.outcomeButtonActive]}
                  >
                    <Text style={[styles.outcomeText, outcome === item && styles.outcomeTextActive]}>
                      {formatOutcome(item)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                multiline
                onChangeText={setDisposition}
                placeholder="Disposition note"
                style={[styles.input, styles.textArea]}
                value={disposition}
              />
              {callError ? <Text style={styles.error}>{callError}</Text> : null}
              <Pressable disabled={savingCall} onPress={saveCallOutcome} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>{savingCall ? 'Saving...' : 'Save outcome'}</Text>
              </Pressable>
            </View>
          ) : callError ? (
            <Text style={styles.error}>{callError}</Text>
          ) : null}

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Recent activity</Text>
            {activities.length === 0 ? (
              <Text style={styles.leadMeta}>No activity yet.</Text>
            ) : (
              activities.map((activity) => <ActivityRow key={activity.id} activity={activity} />)
            )}
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  )
}

function ActivityRow({ activity }: { activity: CrmActivity }) {
  return (
    <View style={styles.activityRow}>
      <Text style={styles.activityType}>{activity.activity_type}</Text>
      <Text style={styles.leadMeta}>{activity.description || 'No description'}</Text>
      <Text style={styles.activityDate}>{new Date(activity.created_at).toLocaleString()}</Text>
    </View>
  )
}

function formatLocation(lead: CrmLead) {
  return [lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
}

function formatOutcome(outcome: CallOutcome) {
  return outcome.replace(/_/g, ' ')
}

function CenteredStatus({ label }: { label: string }) {
  return (
    <SafeAreaView style={styles.centered}>
      <ActivityIndicator />
      <Text style={styles.body}>{label}</Text>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F8FC',
    paddingHorizontal: 20,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#F6F8FC',
    gap: 12,
    justifyContent: 'center',
  },
  header: {
    gap: 10,
    paddingBottom: 24,
    paddingTop: 36,
  },
  headerCompact: {
    gap: 8,
    paddingBottom: 16,
  },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 22,
    paddingTop: 18,
  },
  toolbarTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
  },
  eyebrow: {
    color: '#52606d',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  title: {
    color: '#111827',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 0,
  },
  body: {
    color: '#52606d',
    fontSize: 15,
    lineHeight: 22,
  },
  panel: {
    backgroundColor: '#ffffff',
    borderColor: '#D8E0EB',
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  mono: {
    color: '#111827',
    fontFamily: 'Courier',
    fontSize: 13,
  },
  form: {
    gap: 12,
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#CBD5E1',
    borderRadius: 12,
    borderWidth: 1,
    color: '#111827',
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#E32E2E',
    borderRadius: 12,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#CBD5E1',
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  error: {
    color: '#C81E1E',
    fontSize: 14,
    lineHeight: 20,
  },
  success: {
    color: '#15803D',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  incomingBanner: {
    alignItems: 'center',
    backgroundColor: '#ECFDF3',
    borderColor: '#86EFAC',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    padding: 14,
  },
  incomingTitle: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  incomingNumber: {
    color: '#0B2540',
    fontSize: 18,
    fontWeight: '800',
    paddingTop: 3,
  },
  declineButton: {
    alignItems: 'center',
    backgroundColor: '#E32E2E',
    borderRadius: 10,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  answerButton: {
    alignItems: 'center',
    backgroundColor: '#16A34A',
    borderRadius: 10,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  mobileTabs: {
    backgroundColor: '#E9EEF6',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
    marginBottom: 16,
    padding: 4,
  },
  mobileTab: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  mobileTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0B2540',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  mobileTabText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '700',
  },
  mobileTabTextActive: {
    color: '#D4212A',
  },
  list: {
    gap: 10,
    paddingBottom: 24,
  },
  syncBanner: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderColor: '#A5B4FC',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 14,
    padding: 12,
  },
  syncText: {
    color: '#3730A3',
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  syncButton: {
    alignItems: 'center',
    backgroundColor: '#4F46E5',
    borderRadius: 10,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  syncButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  detailContent: {
    gap: 14,
    paddingBottom: 28,
  },
  sectionTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  leadRow: {
    backgroundColor: '#ffffff',
    borderColor: '#D8E0EB',
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  leadRowTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  leadName: {
    color: '#111827',
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
  },
  badge: {
    backgroundColor: '#FEE2E2',
    borderRadius: 999,
    color: '#C81E1E',
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    textTransform: 'uppercase',
  },
  leadMeta: {
    color: '#52606d',
    fontSize: 14,
  },
  leadActions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 8,
  },
  callButton: {
    alignItems: 'center',
    backgroundColor: '#16A34A',
    borderRadius: 10,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  callButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  noteButton: {
    alignItems: 'center',
    backgroundColor: '#E8F0FE',
    borderRadius: 10,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  noteButtonText: {
    color: '#175CD3',
    fontSize: 15,
    fontWeight: '800',
  },
  outcomeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  outcomeButton: {
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  outcomeButtonActive: {
    backgroundColor: '#E8F0FE',
    borderColor: '#2563EB',
  },
  outcomeText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  outcomeTextActive: {
    color: '#1D4ED8',
  },
  textArea: {
    minHeight: 88,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  activityRow: {
    borderTopColor: '#E2E8F0',
    borderTopWidth: 1,
    gap: 4,
    paddingTop: 10,
  },
  activityType: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  activityDate: {
    color: '#7b8794',
    fontSize: 12,
  },
  needsReplyRow: {
    backgroundColor: '#FFF7F7',
    borderColor: '#FCA5A5',
  },
  replyBadge: {
    backgroundColor: '#FEE2E2',
    borderRadius: 999,
    color: '#C81E1E',
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    textTransform: 'uppercase',
  },
  conversationMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  channelTabs: {
    backgroundColor: '#E9EEF6',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  channelTab: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
  },
  channelTabActive: {
    backgroundColor: '#FFFFFF',
  },
  channelTabText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '700',
  },
  channelTabTextActive: {
    color: '#D4212A',
  },
  phoneCard: {
    backgroundColor: '#0B2540',
    borderRadius: 20,
    gap: 18,
    padding: 22,
  },
  phoneIdentity: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  dialInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#93A4B8',
    borderRadius: 14,
    borderWidth: 1,
    color: '#0B2540',
    fontSize: 28,
    minHeight: 64,
    paddingHorizontal: 16,
    textAlign: 'center',
  },
  hangupButton: {
    alignItems: 'center',
    backgroundColor: '#E32E2E',
    borderRadius: 12,
    minHeight: 54,
    justifyContent: 'center',
  },
})
