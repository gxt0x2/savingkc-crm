import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mobileConfig } from '../config'

const secureStorage = {
  getItem: (key: string) => {
    if (Platform.OS === 'web') return Promise.resolve(globalThis.localStorage?.getItem(key) ?? null)
    return SecureStore.getItemAsync(key)
  },
  setItem: (key: string, value: string) => {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(key, value)
      return Promise.resolve()
    }
    return SecureStore.setItemAsync(key, value)
  },
  removeItem: (key: string) => {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(key)
      return Promise.resolve()
    }
    return SecureStore.deleteItemAsync(key)
  },
}

let client: SupabaseClient | null = null

export function getSupabaseClient() {
  if (!mobileConfig.supabaseUrl || !mobileConfig.supabaseAnonKey) return null
  if (!client) {
    client = createClient(mobileConfig.supabaseUrl, mobileConfig.supabaseAnonKey, {
      auth: {
        storage: secureStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  }
  return client
}
