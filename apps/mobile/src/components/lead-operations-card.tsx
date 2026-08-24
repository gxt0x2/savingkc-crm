import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { acceptMobileHandoff, assignMobileOwner, completeMobileWorkItem } from '../lib/api'
import type { LeadOperations } from '../types'

export function LeadOperationsCard({
  accessToken,
  leadId,
  operations,
  onChanged,
}: {
  accessToken: string
  leadId: string
  operations: LeadOperations
  onChanged: () => Promise<unknown>
}) {
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(key: string, action: () => Promise<unknown>) {
    if (saving) return
    setSaving(key)
    setError(null)
    try {
      await action()
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The action was not saved.')
    } finally {
      setSaving(null)
    }
  }

  const task = operations.primaryNextAction
  return <View style={styles.card}>
    <Text style={styles.title}>Responsibility</Text>
    <Text style={styles.meta}>Department · {operations.department.replaceAll('_', ' ')}</Text>
    <Text style={styles.meta}>Owner · {operations.owner || 'Unassigned'}</Text>
    <View style={styles.ownerGrid}>
      {[null, 'Ernest', 'Casey', 'Gertha'].map((owner) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: operations.owner === owner }}
          disabled={Boolean(saving) || operations.owner === owner}
          key={owner || 'unassigned'}
          onPress={() => run(`owner:${owner || 'unassigned'}`, () => assignMobileOwner({ accessToken, leadId, owner }))}
          style={[styles.ownerButton, operations.owner === owner && styles.ownerButtonActive]}
        >
          <Text style={[styles.ownerText, operations.owner === owner && styles.ownerTextActive]}>{owner || 'Unassigned'}</Text>
        </Pressable>
      ))}
    </View>

    <Text style={styles.title}>Primary next action</Text>
    {!operations.tasksAvailable ? <Text style={styles.error}>Task state is unavailable. Nothing is shown as complete.</Text> : task ? <>
      <Text style={styles.taskTitle}>{task.title}</Text>
      <Text style={styles.meta}>{task.assignedTo || 'Unassigned'} · {task.dueAt ? new Date(task.dueAt).toLocaleString() : 'No due date'}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={Boolean(saving) || task.status === 'blocked'}
        onPress={() => run(`task:${task.key}`, () => completeMobileWorkItem({ accessToken, key: task.key, expectedVersion: task.version }))}
        style={[styles.primaryButton, (Boolean(saving) || task.status === 'blocked') && styles.disabled]}
      ><Text style={styles.primaryText}>{saving === `task:${task.key}` ? 'Saving…' : task.status === 'blocked' ? 'Blocked' : 'Complete next action'}</Text></Pressable>
    </> : <Text style={styles.meta}>No current next action.</Text>}

    {operations.handoffsAvailable && operations.pendingHandoffs.length ? <>
      <Text style={styles.title}>Pending handoff</Text>
      {operations.pendingHandoffs.map((handoff) => <View key={handoff.id} style={styles.handoffRow}>
        <Text style={styles.meta}>{handoff.from_department.replaceAll('_', ' ')} → {handoff.to_department.replaceAll('_', ' ')}</Text>
        <Pressable accessibilityRole="button" disabled={Boolean(saving)} onPress={() => run(`handoff:${handoff.id}`, () => acceptMobileHandoff({ accessToken, handoffId: handoff.id }))} style={[styles.primaryButton, Boolean(saving) && styles.disabled]}><Text style={styles.primaryText}>{saving === `handoff:${handoff.id}` ? 'Accepting…' : 'Accept handoff'}</Text></Pressable>
      </View>)}
    </> : !operations.handoffsAvailable ? <Text style={styles.error}>Handoff state is unavailable.</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderColor: '#D8E0EB', borderRadius: 14, borderWidth: 1, gap: 9, padding: 14 },
  title: { color: '#111827', fontSize: 16, fontWeight: '900', paddingTop: 2 },
  meta: { color: '#52606D', fontSize: 14, lineHeight: 20, textTransform: 'capitalize' },
  ownerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  ownerButton: { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0', borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 },
  ownerButtonActive: { backgroundColor: '#FEE2E2', borderColor: '#D4212A' },
  ownerText: { color: '#475569', fontSize: 12, fontWeight: '800' },
  ownerTextActive: { color: '#B91C1C' },
  taskTitle: { color: '#111827', fontSize: 15, fontWeight: '800' },
  primaryButton: { alignItems: 'center', backgroundColor: '#D4212A', borderRadius: 10, minHeight: 42, justifyContent: 'center', paddingHorizontal: 12 },
  primaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  handoffRow: { gap: 7 },
  error: { color: '#B91C1C', fontSize: 13, fontWeight: '700', lineHeight: 18 },
  disabled: { opacity: 0.45 },
})
