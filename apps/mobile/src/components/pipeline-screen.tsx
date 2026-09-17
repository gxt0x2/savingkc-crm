import { useDeferredValue, useState } from 'react'
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'

import { fetchPipeline } from '../lib/api'
import type { CrmLead, MobilePipelineList } from '../types'

const PIPELINE_LISTS: ReadonlyArray<{ id: MobilePipelineList; label: string }> = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Leads' },
  { id: 'qualified', label: 'Opportunities' },
  { id: 'appointment_set', label: 'Appointments' },
  { id: 'offer_made', label: 'Offers' },
  { id: 'in_closing', label: 'Closing' },
  { id: 'all', label: 'All' },
]

function initials(value: string | null) {
  const parts = value?.trim().split(/\s+/).filter(Boolean) ?? []
  return (parts.length ? parts.slice(0, 2).map((part) => part[0]).join('') : 'SK').toUpperCase()
}

function stageLabel(lead: CrmLead) {
  if (lead.station === 'appointment_set') return 'Appointment set'
  if (lead.station === 'offer_made') return 'Offer made'
  if (lead.station === 'under_contract') return 'In closing'
  if (lead.station === 'qualified' || lead.classification === 'opportunity') return 'Opportunity'
  if (lead.station === 'new') return 'New inquiry'
  return 'Lead'
}

function relativeTime(value: string | null | undefined) {
  if (!value) return 'No activity'
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed)) return 'No activity'
  const minutes = Math.max(0, Math.floor(elapsed / 60_000))
  if (minutes < 1) return 'Now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function PipelineCard({
  lead,
  onCall,
  onMessage,
  onOpen,
}: {
  lead: CrmLead
  onCall: () => void
  onMessage: () => void
  onOpen: () => void
}) {
  const needsReply = lead.attention_state === 'needs_reply'
  return (
    <View style={[styles.card, needsReply && styles.cardAttention]}>
      <Pressable accessibilityLabel={`Open ${lead.full_name || 'contact'}`} onPress={onOpen} style={styles.cardHeader}>
        <View style={[styles.avatar, needsReply && styles.avatarAttention]}>
          <Text style={[styles.avatarText, needsReply && styles.avatarTextAttention]}>{initials(lead.full_name)}</Text>
        </View>
        <View style={styles.cardIdentity}>
          <View style={styles.nameRow}>
            <Text numberOfLines={1} style={styles.name}>{lead.full_name || lead.phone || 'Unnamed contact'}</Text>
            <Text style={styles.activityTime}>{relativeTime(lead.last_activity_at || lead.updated_at)}</Text>
          </View>
          <Text numberOfLines={1} style={styles.address}>{lead.property_address || lead.city || 'No property linked'}</Text>
        </View>
      </Pressable>

      <View style={styles.signalRow}>
        <Text style={styles.stagePill}>{stageLabel(lead)}</Text>
        {needsReply ? <Text style={styles.replyPill}>Needs reply</Text> : null}
        {lead.is_favorite ? <Text style={styles.favorite}>★</Text> : null}
      </View>

      <Text numberOfLines={1} style={styles.preview}>{lead.last_message || lead.phone || 'No conversation yet'}</Text>
      {lead.primary_next_action ? (
        <Pressable onPress={onOpen} style={[styles.nextAction, lead.primary_next_action.overdue && styles.nextActionOverdue]}>
          <Text numberOfLines={1} style={[styles.nextActionText, lead.primary_next_action.overdue && styles.nextActionTextOverdue]}>
            {lead.primary_next_action.overdue ? 'Overdue · ' : 'Next · '}{lead.primary_next_action.title}
          </Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        <Pressable accessibilityLabel={`Call ${lead.full_name || 'contact'}`} disabled={!lead.phone} onPress={onCall} style={[styles.callAction, !lead.phone && styles.disabled]}>
          <Text style={styles.callActionText}>☎  Call</Text>
        </Pressable>
        <Pressable accessibilityLabel={`Message ${lead.full_name || 'contact'}`} disabled={!lead.phone && !lead.email} onPress={onMessage} style={[styles.messageAction, !lead.phone && !lead.email && styles.disabled]}>
          <Text style={styles.messageActionText}>●  Message</Text>
        </Pressable>
      </View>
    </View>
  )
}

export function PipelineScreen({
  accessToken,
  onCall,
  onMessage,
  onOpen,
}: {
  accessToken: string
  onCall: (leadId: string) => void
  onMessage: (leadId: string) => void
  onOpen: (leadId: string) => void
}) {
  const [list, setList] = useState<MobilePipelineList>('contacted')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const pipelineQuery = useQuery({
    queryKey: ['mobile-pipeline', list, deferredSearch],
    queryFn: ({ signal }) => fetchPipeline({ accessToken, list, search: deferredSearch, signal }),
    placeholderData: (previous) => previous,
  })

  const count = pipelineQuery.data?.counts[list] ?? pipelineQuery.data?.pageInfo.total ?? 0
  return (
    <View style={styles.screen}>
      <View style={styles.titleRow}>
        <View>
          <Text style={styles.eyebrow}>Sales workspace</Text>
          <View style={styles.titleLine}>
            <Text style={styles.title}>Pipeline</Text>
            <Text style={styles.count}>{count}</Text>
          </View>
        </View>
        <Pressable accessibilityLabel="Refresh Pipeline" onPress={() => pipelineQuery.refetch()} style={styles.refresh}>
          <Text style={styles.refreshText}>{pipelineQuery.isFetching ? '···' : '↻'}</Text>
        </Pressable>
      </View>

      <View style={styles.searchShell}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          autoCapitalize="none"
          onChangeText={setSearch}
          placeholder="Search contacts or property"
          placeholderTextColor="#9A97A9"
          style={styles.searchInput}
          value={search}
        />
      </View>

      <ScrollView contentContainerStyle={styles.filters} horizontal showsHorizontalScrollIndicator={false}>
        {PIPELINE_LISTS.map((item) => {
          const selected = list === item.id
          return (
            <Pressable key={item.id} onPress={() => setList(item.id)} style={[styles.filter, selected && styles.filterActive]}>
              <Text style={[styles.filterText, selected && styles.filterTextActive]}>{item.label}</Text>
              <Text style={[styles.filterCount, selected && styles.filterCountActive]}>{pipelineQuery.data?.counts[item.id] ?? 0}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {pipelineQuery.isError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{pipelineQuery.error.message}</Text>
          <Pressable onPress={() => pipelineQuery.refetch()}><Text style={styles.retryText}>Try again</Text></Pressable>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={pipelineQuery.data?.leads ?? []}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.empty}>{pipelineQuery.isLoading ? 'Loading Pipeline…' : 'No contacts match this view.'}</Text>}
          ListFooterComponent={pipelineQuery.data?.pageInfo.hasMore ? <Text style={styles.more}>Showing the first 50. Search or choose a stage to narrow the list.</Text> : null}
          onRefresh={() => pipelineQuery.refetch()}
          refreshing={pipelineQuery.isFetching && !pipelineQuery.isLoading}
          renderItem={({ item }) => (
            <PipelineCard
              lead={item}
              onCall={() => onCall(item.id)}
              onMessage={() => onMessage(item.id)}
              onOpen={() => onOpen(item.id)}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  titleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 14 },
  eyebrow: { color: '#77748A', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  titleLine: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingTop: 2 },
  title: { color: '#191819', fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
  count: { backgroundColor: '#E8E5FF', borderRadius: 999, color: '#433DD9', fontSize: 12, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3 },
  refresh: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, height: 38, justifyContent: 'center', width: 38 },
  refreshText: { color: '#433DD9', fontSize: 20, fontWeight: '900' },
  searchShell: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E6E2F5', borderRadius: 16, borderWidth: 1, flexDirection: 'row', marginBottom: 12, paddingHorizontal: 14 },
  searchIcon: { color: '#77748A', fontSize: 22, paddingRight: 8 },
  searchInput: { color: '#191819', flex: 1, fontSize: 15, minHeight: 50 },
  filters: { gap: 8, paddingBottom: 14, paddingRight: 12 },
  filter: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E6E2F5', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, minHeight: 38, paddingHorizontal: 13 },
  filterActive: { backgroundColor: '#433DD9', borderColor: '#433DD9' },
  filterText: { color: '#686579', fontSize: 12, fontWeight: '800' },
  filterTextActive: { color: '#FFFFFF' },
  filterCount: { color: '#9A97A9', fontSize: 11, fontWeight: '900' },
  filterCountActive: { color: '#D9D7FF' },
  list: { gap: 10, paddingBottom: 10 },
  card: { backgroundColor: '#FFFFFF', borderColor: '#E6E2F5', borderRadius: 20, borderWidth: 1, gap: 10, padding: 14 },
  cardAttention: { borderColor: '#C7C2FF' },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: 11 },
  avatar: { alignItems: 'center', backgroundColor: '#E8F2FF', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  avatarAttention: { backgroundColor: '#E8E5FF' },
  avatarText: { color: '#2C53E0', fontSize: 14, fontWeight: '900' },
  avatarTextAttention: { color: '#433DD9' },
  cardIdentity: { flex: 1, minWidth: 0 },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  name: { color: '#191819', flex: 1, fontSize: 16, fontWeight: '900' },
  activityTime: { color: '#AAA8B3', fontSize: 11, fontWeight: '700' },
  address: { color: '#77748A', fontSize: 13, paddingTop: 3 },
  signalRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  stagePill: { backgroundColor: '#F2F0FE', borderRadius: 999, color: '#433DD9', fontSize: 10, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 4, textTransform: 'uppercase' },
  replyPill: { backgroundColor: '#FFF0F1', borderRadius: 999, color: '#D4212A', fontSize: 10, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 4, textTransform: 'uppercase' },
  favorite: { color: '#F59E0B', fontSize: 14 },
  preview: { color: '#686579', fontSize: 13 },
  nextAction: { alignItems: 'center', backgroundColor: '#F6F5FC', borderRadius: 12, flexDirection: 'row', minHeight: 38, paddingHorizontal: 11 },
  nextActionOverdue: { backgroundColor: '#FFF0F1' },
  nextActionText: { color: '#433DD9', flex: 1, fontSize: 12, fontWeight: '800' },
  nextActionTextOverdue: { color: '#C81E1E' },
  chevron: { color: '#9A97A9', fontSize: 20 },
  actions: { flexDirection: 'row', gap: 8 },
  callAction: { alignItems: 'center', backgroundColor: '#ECFDF3', borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 42 },
  callActionText: { color: '#15803D', fontSize: 13, fontWeight: '900' },
  messageAction: { alignItems: 'center', backgroundColor: '#EEF3FF', borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 42 },
  messageActionText: { color: '#2C53E0', fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.4 },
  empty: { color: '#77748A', fontSize: 14, padding: 28, textAlign: 'center' },
  more: { color: '#77748A', fontSize: 11, lineHeight: 16, padding: 12, textAlign: 'center' },
  errorCard: { backgroundColor: '#FFF0F1', borderColor: '#F4B4B8', borderRadius: 16, borderWidth: 1, gap: 8, padding: 16 },
  errorText: { color: '#A61B23', fontSize: 13, fontWeight: '700' },
  retryText: { color: '#433DD9', fontSize: 13, fontWeight: '900' },
})
