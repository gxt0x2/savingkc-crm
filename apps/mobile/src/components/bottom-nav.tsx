import { Pressable, StyleSheet, Text, View } from 'react-native'

export type MobileTab = 'pipeline' | 'conversations' | 'calendar' | 'phone'

const NAV_ITEMS: ReadonlyArray<{ id: MobileTab; icon: string; label: string }> = [
  { id: 'pipeline', icon: '▦', label: 'Pipeline' },
  { id: 'conversations', icon: '◉', label: 'Inbox' },
  { id: 'calendar', icon: '□', label: 'Calendar' },
  { id: 'phone', icon: '☎', label: 'Phone' },
]

export function BottomNav({ active, onChange }: { active: MobileTab; onChange: (tab: MobileTab) => void }) {
  return (
    <View accessibilityRole="tablist" style={styles.shell}>
      {NAV_ITEMS.map((item) => {
        const selected = active === item.id
        return (
          <Pressable
            accessibilityLabel={item.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={item.id}
            onPress={() => onChange(item.id)}
            style={[styles.item, selected && styles.itemActive]}
          >
            <Text style={[styles.icon, selected && styles.iconActive]}>{item.icon}</Text>
            <Text style={[styles.label, selected && styles.labelActive]}>{item.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E6E2F5',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
    marginTop: 10,
    padding: 6,
    shadowColor: '#191819',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
  },
  item: {
    alignItems: 'center',
    borderRadius: 16,
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 54,
  },
  itemActive: {
    backgroundColor: '#433DD9',
  },
  icon: {
    color: '#8B88A3',
    fontSize: 18,
    fontWeight: '900',
  },
  iconActive: {
    color: '#FFFFFF',
  },
  label: {
    color: '#77748A',
    fontSize: 10,
    fontWeight: '800',
  },
  labelActive: {
    color: '#FFFFFF',
  },
})
