import { StyleSheet, Text, View } from 'react-native'
import type { CrmActivity } from '../types'

export function ActivityRow({ activity }: { activity: CrmActivity }) {
  return <View style={styles.row}>
    <Text style={styles.type}>{activity.activity_type}</Text>
    <Text style={styles.description}>{activity.description || 'No description'}</Text>
    <Text style={styles.date}>{new Date(activity.created_at).toLocaleString()}</Text>
  </View>
}

const styles = StyleSheet.create({
  row: { borderTopColor: '#E2E8F0', borderTopWidth: 1, gap: 4, paddingTop: 10 },
  type: { color: '#111827', fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  description: { color: '#52606D', fontSize: 14 },
  date: { color: '#7B8794', fontSize: 12 },
})
