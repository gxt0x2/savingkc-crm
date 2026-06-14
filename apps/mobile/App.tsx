import { StatusBar } from 'expo-status-bar'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
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
import { fetchLeadDetail, fetchLeads, fetchMobileSession, logCallEvent } from './src/lib/api'
import { enqueueCallEvent, flushCallOutbox, getQueuedCallEvents } from './src/lib/call-outbox'
import { startOutboundCall } from './src/lib/call-service'
import { getSupabaseClient } from './src/lib/supabase'
import type { CallOutcome, CrmActivity, CrmLead } from './src/types'

const queryClient = new QueryClient()

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

  return <LeadListScreen accessToken={session.access_token} email={session.user.email ?? 'Agent'} />
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

function LeadListScreen({ accessToken, email }: { accessToken: string; email: string }) {
  const supabase = getSupabaseClient()
  const queryClient = useQueryClient()
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [queuedEvents, setQueuedEvents] = useState(0)
  const [syncingOutbox, setSyncingOutbox] = useState(false)
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

      <View style={styles.headerCompact}>
        <Text style={styles.title}>Leads</Text>
        <Text style={styles.body}>
          {sessionQuery.data?.capabilities.outboundDeviceDialer
            ? 'Mobile API online. Device dialer enabled.'
            : sessionQuery.isError
              ? 'Mobile API session check failed.'
              : 'Checking mobile API capabilities...'}
        </Text>
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
          data={leadsQuery.data}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <LeadRow lead={item} onOpen={() => setSelectedLeadId(item.id)} />}
          refreshing={leadsQuery.isFetching}
          onRefresh={() => leadsQuery.refetch()}
        />
      )}
    </SafeAreaView>
  )
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
  const [activeCall, setActiveCall] = useState<{ phone: string; startedAt: number; clientCallId: string } | null>(null)
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
      await logCallEvent({
        accessToken,
        leadId: lead.id,
        phone: lead.phone,
        event: 'started',
        clientCallId,
      })
      setActiveCall({ phone: lead.phone, startedAt: Date.now(), clientCallId })
      await startOutboundCall(lead.phone)
    } catch (error) {
      await enqueueCallEvent({
        accessToken,
        leadId: lead.id,
        phone: lead.phone,
        event: 'started',
        clientCallId,
      }).catch(() => null)
      onOutboxChange()
      setActiveCall({ phone: lead.phone, startedAt: Date.now(), clientCallId })
      setCallError(error instanceof Error ? error.message : 'Call start was queued for sync.')
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
    backgroundColor: '#f7f8fa',
    paddingHorizontal: 20,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#f7f8fa',
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
    borderColor: '#d8dee6',
    borderRadius: 8,
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
    borderColor: '#cfd6df',
    borderRadius: 8,
    borderWidth: 1,
    color: '#111827',
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#146c5c',
    borderRadius: 8,
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
    borderColor: '#cfd6df',
    borderRadius: 8,
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
    color: '#b42318',
    fontSize: 14,
    lineHeight: 20,
  },
  list: {
    gap: 10,
    paddingBottom: 24,
  },
  syncBanner: {
    alignItems: 'center',
    backgroundColor: '#fff8e6',
    borderColor: '#f0c36a',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 14,
    padding: 12,
  },
  syncText: {
    color: '#6f4e00',
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  syncButton: {
    alignItems: 'center',
    backgroundColor: '#6f4e00',
    borderRadius: 8,
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
    borderColor: '#d8dee6',
    borderRadius: 8,
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
    backgroundColor: '#eaf4ef',
    borderRadius: 8,
    color: '#146c5c',
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
    backgroundColor: '#146c5c',
    borderRadius: 8,
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
    backgroundColor: '#edf1f5',
    borderRadius: 8,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  noteButtonText: {
    color: '#111827',
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
    backgroundColor: '#edf1f5',
    borderColor: '#edf1f5',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  outcomeButtonActive: {
    backgroundColor: '#eaf4ef',
    borderColor: '#146c5c',
  },
  outcomeText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  outcomeTextActive: {
    color: '#146c5c',
  },
  textArea: {
    minHeight: 88,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  activityRow: {
    borderTopColor: '#edf1f5',
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
})
