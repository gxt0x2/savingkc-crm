type TimestampedRow = {
  id: string
  created_at: string | null
}

export function mergeCallActivityRows<Row extends TimestampedRow>(...rowGroups: Row[][]): Row[] {
  const rowsById = new Map<string, Row>()
  for (const row of rowGroups.flat()) rowsById.set(row.id, row)
  return Array.from(rowsById.values()).sort((left, right) => Date.parse(right.created_at || '') - Date.parse(left.created_at || ''))
}
