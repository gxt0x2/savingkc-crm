// JSONB changes object key order. Canonical serialization preserves source
// identity across database round-trips and recovery on another machine.
export function serializeMojoSource(value) {
  function normalize(item) {
    if (Array.isArray(item)) return item.map(normalize)
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])]))
    }
    return item
  }
  return JSON.stringify(normalize(value))
}
