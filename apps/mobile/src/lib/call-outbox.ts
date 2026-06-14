import AsyncStorage from '@react-native-async-storage/async-storage'
import { logCallEvent } from './api'
import type { CallOutcome } from '../types'

const STORAGE_KEY = 'savingkc.mobile.callOutbox.v1'

export type QueuedCallEvent = {
  id: string
  accessToken: string
  leadId: string
  phone: string
  event: 'started' | 'ended'
  durationSeconds?: number
  outcome?: CallOutcome
  disposition?: string
  clientCallId?: string
  attempts: number
  createdAt: string
  lastError?: string
}

type NewQueuedCallEvent = Omit<QueuedCallEvent, 'attempts' | 'createdAt' | 'id'>

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function readOutbox(): Promise<QueuedCallEvent[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as QueuedCallEvent[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeOutbox(items: QueuedCallEvent[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export async function getQueuedCallEvents() {
  return readOutbox()
}

export async function enqueueCallEvent(event: NewQueuedCallEvent) {
  const items = await readOutbox()
  const queued: QueuedCallEvent = {
    ...event,
    id: createId(),
    attempts: 0,
    createdAt: new Date().toISOString(),
  }
  await writeOutbox([...items, queued])
  return queued
}

export async function flushCallOutbox() {
  const items = await readOutbox()
  if (items.length === 0) return { sent: 0, remaining: 0 }

  const remaining: QueuedCallEvent[] = []
  let sent = 0

  for (const item of items) {
    try {
      await logCallEvent(item)
      sent += 1
    } catch (error) {
      remaining.push({
        ...item,
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message : 'Unknown sync error',
      })
    }
  }

  await writeOutbox(remaining)
  return { sent, remaining: remaining.length }
}

export async function clearCallOutbox() {
  await AsyncStorage.removeItem(STORAGE_KEY)
}
