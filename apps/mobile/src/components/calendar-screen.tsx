import { useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'

import { fetchMobileCalendar } from '../lib/api'
import type { MobileCalendarItem } from '../types'

type CalendarFilter = 'today' | 'upcoming' | 'overdue'

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value))
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function CalendarCard({ item, onOpen }: { item: MobileCalendarItem; onOpen: () => void }) {
  const appointment = item.type === 'appointment'
  return (
    <Pressable disabled={!item.contactId} onPress={onOpen} style={styles.card}>
      <View style={[styles.dateBadge, appointment && styles.dateBadgeAppointment]}>
        <Text style={[styles.time, appointment && styles.timeAppointment]}>{formatTime(item.dueAt)}</Text>
        <Text style={[styles.kind, appointment && styles.kindAppointment]}>{appointment ? 'APPT' : item.type.replaceAll('_', ' ')}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text numberOfLines={1} style={styles.cardTitle}>{item.title}</Text>
        <Text numberOfLines={1} style={styles.contact}>{item.contactName || item.propertyAddress || item.assignedTo || 'Unlinked task'}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.department}>{item.department.replaceAll('_', ' ')}</Text>
          <Text style={styles.date}>{formatDate(item.dueAt)}</Text>
        </View>
      </View>
      {item.contactId ? <Text style={styles.chevron}>›</Text> : null}
    </Pressable>
  )
}

export function CalendarScreen({ accessToken, onOpenLead }: { accessToken: string; onOpenLead: (leadId: string) => void }) {
  const [filter, setFilter] = useState<CalendarFilter>('today')
  const calendarQuery = useQuery({
    queryKey: ['mobile-calendar'],
    queryFn: ({ signal }) => fetchMobileCalendar({ accessToken, signal }),
  })
  const now = calendarQuery.data?.serverNow ? new Date(calendarQuery.data.serverNow) : new Date()
  const todayStart = startOfDay(now)
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  const buckets = (() => {
    const result: Record<CalendarFilter, MobileCalendarItem[]> = { today: [], upcoming: [], overdue: [] }
    for (const item of calendarQuery.data?.items ?? []) {
      const timestamp = new Date(item.dueAt).getTime()
      if (timestamp < todayStart) result.overdue.push(item)
      else if (timestamp < tomorrowStart) result.today.push(item)
      else result.upcoming.push(item)
    }
    return result
  })()

  return (
    <View style={styles.screen}>
      <View style={styles.titleRow}>
        <View>
          <Text style={styles.eyebrow}>Schedule</Text>
          <Text style={styles.title}>Calendar</Text>
        </View>
        <View style={styles.todayBadge}>
          <Text style={styles.todayMonth}>{new Intl.DateTimeFormat('en-US', { month: 'short' }).format(now).toUpperCase()}</Text>
          <Text style={styles.todayDate}>{now.getDate()}</Text>
        </View>
      </View>

      <View style={styles.filters}>
        {(['today', 'upcoming', 'overdue'] as CalendarFilter[]).map((item) => {
          const selected = filter === item
          return (
            <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filter, selected && styles.filterActive]}>
              <Text style={[styles.filterText, selected && styles.filterTextActive]}>{item}</Text>
              <Text style={[styles.filterCount, selected && styles.filterCountActive]}>{buckets[item].length}</Text>
            </Pressable>
          )
        })}
      </View>

      {calendarQuery.isError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{calendarQuery.error.message}</Text>
          <Pressable onPress={() => calendarQuery.refetch()}><Text style={styles.retryText}>Try again</Text></Pressable>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={buckets[filter]}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.empty}>{calendarQuery.isLoading ? 'Loading schedule…' : `Nothing ${filter === 'today' ? 'scheduled today' : filter}.`}</Text>}
          onRefresh={() => calendarQuery.refetch()}
          refreshing={calendarQuery.isFetching && !calendarQuery.isLoading}
          renderItem={({ item }) => <CalendarCard item={item} onOpen={() => item.contactId && onOpenLead(item.contactId)} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  titleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 16 },
  eyebrow: { color: '#77748A', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  title: { color: '#191819', fontSize: 30, fontWeight: '900', letterSpacing: -0.8, paddingTop: 2 },
  todayBadge: { alignItems: 'center', backgroundColor: '#433DD9', borderRadius: 14, minWidth: 48, overflow: 'hidden', paddingBottom: 6 },
  todayMonth: { backgroundColor: '#2C53E0', color: '#FFFFFF', fontSize: 9, fontWeight: '900', paddingHorizontal: 12, paddingVertical: 4, width: '100%' },
  todayDate: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', paddingTop: 2 },
  filters: { backgroundColor: '#E8E5FF', borderRadius: 16, flexDirection: 'row', gap: 4, marginBottom: 14, padding: 4 },
  filter: { alignItems: 'center', borderRadius: 12, flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', minHeight: 42 },
  filterActive: { backgroundColor: '#FFFFFF' },
  filterText: { color: '#77748A', fontSize: 12, fontWeight: '800', textTransform: 'capitalize' },
  filterTextActive: { color: '#433DD9' },
  filterCount: { color: '#9A97A9', fontSize: 10, fontWeight: '900' },
  filterCountActive: { color: '#433DD9' },
  list: { gap: 10, paddingBottom: 10 },
  card: { alignItems: 'center', backgroundColor: '#FFFFFF', borderColor: '#E6E2F5', borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 13 },
  dateBadge: { alignItems: 'center', backgroundColor: '#EEF3FF', borderRadius: 13, gap: 2, justifyContent: 'center', minHeight: 58, minWidth: 66, paddingHorizontal: 8 },
  dateBadgeAppointment: { backgroundColor: '#F2F0FE' },
  time: { color: '#2C53E0', fontSize: 13, fontWeight: '900' },
  timeAppointment: { color: '#433DD9' },
  kind: { color: '#6B82C5', fontSize: 8, fontWeight: '900', textTransform: 'uppercase' },
  kindAppointment: { color: '#7770C9' },
  cardBody: { flex: 1, gap: 3, minWidth: 0 },
  cardTitle: { color: '#191819', fontSize: 15, fontWeight: '900' },
  contact: { color: '#686579', fontSize: 12 },
  metaRow: { flexDirection: 'row', gap: 8 },
  department: { color: '#9A97A9', fontSize: 10, fontWeight: '800', textTransform: 'capitalize' },
  date: { color: '#9A97A9', fontSize: 10 },
  chevron: { color: '#AAA8B3', fontSize: 24 },
  empty: { color: '#77748A', fontSize: 14, padding: 34, textAlign: 'center' },
  errorCard: { backgroundColor: '#FFF0F1', borderColor: '#F4B4B8', borderRadius: 16, borderWidth: 1, gap: 8, padding: 16 },
  errorText: { color: '#A61B23', fontSize: 13, fontWeight: '700' },
  retryText: { color: '#433DD9', fontSize: 13, fontWeight: '900' },
})
