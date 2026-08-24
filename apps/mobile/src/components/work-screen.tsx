import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { acceptMobileHandoff, completeMobileWorkItem, fetchMobileWork } from '../lib/api'
import type { MobileHandoff, MobileWorkItem } from '../types'

type Department = 'acquisitions' | 'dispositions' | 'tc'
type Scope = 'mine' | 'unassigned'

export function WorkScreen({ accessToken, onOpenLead }: { accessToken: string; onOpenLead: (id: string) => void }) {
  const queryClient = useQueryClient()
  const [department, setDepartment] = useState<Department>('acquisitions')
  const [scope, setScope] = useState<Scope>('mine')
  const workQuery = useQuery({
    queryKey: ['mobile-work', department, scope],
    queryFn: ({ signal }) => fetchMobileWork({ accessToken, department, scope, signal }),
  })
  const completeMutation = useMutation({
    mutationFn: (item: MobileWorkItem) => completeMobileWorkItem({ accessToken, key: item.key, expectedVersion: item.version }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['mobile-work'] }),
  })
  const acceptMutation = useMutation({
    mutationFn: (handoff: MobileHandoff) => acceptMobileHandoff({ accessToken, handoffId: handoff.id }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['mobile-work'] }),
  })

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>My work</Text>
          <Text style={styles.body}>Only current, event-backed work and explicit department handoffs.</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh mobile work" onPress={() => workQuery.refetch()} style={styles.refreshButton}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      <View style={styles.selector}>
        {([['acquisitions', 'Acq'], ['dispositions', 'Dispo'], ['tc', 'TC']] as const).map(([value, label]) => (
          <Pressable accessibilityRole="button" accessibilityState={{ selected: department === value }} key={value} onPress={() => setDepartment(value)} style={[styles.selectorButton, department === value && styles.selectorButtonActive]}>
            <Text style={[styles.selectorText, department === value && styles.selectorTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.selector}>
        {([['mine', 'Mine'], ['unassigned', 'Unassigned']] as const).map(([value, label]) => (
          <Pressable accessibilityRole="button" accessibilityState={{ selected: scope === value }} key={value} onPress={() => setScope(value)} style={[styles.selectorButton, scope === value && styles.selectorButtonActive]}>
            <Text style={[styles.selectorText, scope === value && styles.selectorTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {workQuery.isLoading ? <View style={styles.status}><ActivityIndicator /><Text style={styles.body}>Loading current work…</Text></View> : null}
      {workQuery.isError ? <View style={styles.errorCard}><Text style={styles.error}>Work is unavailable. Nothing has been marked complete.</Text></View> : null}
      {completeMutation.isError || acceptMutation.isError ? <Text style={styles.error}>The action was not saved. Refresh and try again.</Text> : null}

      {workQuery.data ? <>
        <Text style={styles.sectionTitle}>Pending handoffs · {workQuery.data.handoffs.length}</Text>
        {workQuery.data.handoffs.length ? workQuery.data.handoffs.map((handoff) => (
          <HandoffCard
            accepting={acceptMutation.isPending && acceptMutation.variables?.id === handoff.id}
            busy={acceptMutation.isPending}
            handoff={handoff}
            key={handoff.id}
            onAccept={() => acceptMutation.mutate(handoff)}
            onOpen={() => handoff.lead_id && onOpenLead(handoff.lead_id)}
          />
        )) : <Text style={styles.empty}>No handoffs are waiting for this department.</Text>}

        <Text style={styles.sectionTitle}>{scope === 'mine' ? 'My current tasks' : 'Unassigned current tasks'} · {workQuery.data.tasks.length}</Text>
        {workQuery.data.tasks.length ? workQuery.data.tasks.map((item) => (
          <TaskCard
            completing={completeMutation.isPending && completeMutation.variables?.key === item.key}
            busy={completeMutation.isPending}
            item={item}
            key={item.key}
            onComplete={() => completeMutation.mutate(item)}
            onOpen={() => item.leadId && onOpenLead(item.leadId)}
          />
        )) : <Text style={styles.empty}>No current tasks match this view.</Text>}
      </> : null}
    </ScrollView>
  )
}

function TaskCard({ item, busy, completing, onComplete, onOpen }: { item: MobileWorkItem; busy: boolean; completing: boolean; onComplete: () => void; onOpen: () => void }) {
  const contact = item.contact?.fullName || item.contact?.propertyAddress || 'Unlinked contact'
  return <View style={styles.card}>
    <View style={styles.cardHeader}><Text style={styles.cardTitle}>{item.title}</Text>{item.primaryNextAction ? <Text style={styles.badge}>Primary</Text> : null}</View>
    <Text style={styles.meta}>{contact} · {item.assignedTo || 'Unassigned'}</Text>
    <Text style={styles.meta}>{item.dueAt ? `Due ${new Date(item.dueAt).toLocaleString()}` : 'No due date'}</Text>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" disabled={!item.leadId} onPress={onOpen} style={[styles.secondaryAction, !item.leadId && styles.disabled]}><Text style={styles.secondaryText}>Open contact</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy || item.status === 'blocked'} onPress={onComplete} style={[styles.primaryAction, (busy || item.status === 'blocked') && styles.disabled]}><Text style={styles.primaryText}>{completing ? 'Saving…' : item.status === 'blocked' ? 'Blocked' : 'Complete'}</Text></Pressable>
    </View>
  </View>
}

function HandoffCard({ handoff, busy, accepting, onAccept, onOpen }: { handoff: MobileHandoff; busy: boolean; accepting: boolean; onAccept: () => void; onOpen: () => void }) {
  const contact = handoff.leads?.full_name || handoff.leads?.property_address || 'Contact'
  return <View style={styles.card}>
    <Text style={styles.cardTitle}>{contact}</Text>
    <Text style={styles.meta}>{handoff.from_department.replaceAll('_', ' ')} → {handoff.to_department.replaceAll('_', ' ')}</Text>
    <Text style={styles.meta}>{handoff.reason || 'Evidence-backed responsibility transfer'}</Text>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={onOpen} style={styles.secondaryAction}><Text style={styles.secondaryText}>Open contact</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={onAccept} style={[styles.primaryAction, busy && styles.disabled]}><Text style={styles.primaryText}>{accepting ? 'Accepting…' : 'Accept handoff'}</Text></Pressable>
    </View>
  </View>
}

const styles = StyleSheet.create({
  container: { gap: 12, paddingBottom: 28 },
  headingRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  headingCopy: { flex: 1, gap: 4 },
  title: { color: '#111827', fontSize: 28, fontWeight: '900' },
  body: { color: '#52606D', fontSize: 14, lineHeight: 20 },
  refreshButton: { backgroundColor: '#E8F0FE', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  refreshText: { color: '#175CD3', fontSize: 13, fontWeight: '800' },
  selector: { backgroundColor: '#E9EEF6', borderRadius: 12, flexDirection: 'row', gap: 4, padding: 4 },
  selectorButton: { alignItems: 'center', borderRadius: 9, flex: 1, minHeight: 40, justifyContent: 'center' },
  selectorButtonActive: { backgroundColor: '#FFFFFF' },
  selectorText: { color: '#64748B', fontSize: 13, fontWeight: '800' },
  selectorTextActive: { color: '#D4212A' },
  status: { alignItems: 'center', gap: 8, padding: 24 },
  errorCard: { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5', borderRadius: 12, borderWidth: 1, padding: 14 },
  error: { color: '#B91C1C', fontSize: 14, fontWeight: '700' },
  sectionTitle: { color: '#111827', fontSize: 16, fontWeight: '900', marginTop: 8 },
  empty: { color: '#64748B', fontSize: 14, paddingVertical: 12 },
  card: { backgroundColor: '#FFFFFF', borderColor: '#D8E0EB', borderRadius: 14, borderWidth: 1, gap: 7, padding: 14 },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  cardTitle: { color: '#111827', flex: 1, fontSize: 16, fontWeight: '900' },
  badge: { backgroundColor: '#FEE2E2', borderRadius: 999, color: '#C81E1E', fontSize: 10, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 4, textTransform: 'uppercase' },
  meta: { color: '#52606D', fontSize: 13, lineHeight: 18, textTransform: 'capitalize' },
  actions: { flexDirection: 'row', gap: 8, paddingTop: 5 },
  secondaryAction: { alignItems: 'center', backgroundColor: '#E8F0FE', borderRadius: 10, flex: 1, minHeight: 42, justifyContent: 'center' },
  secondaryText: { color: '#175CD3', fontSize: 13, fontWeight: '800' },
  primaryAction: { alignItems: 'center', backgroundColor: '#D4212A', borderRadius: 10, flex: 1, minHeight: 42, justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.45 },
})
