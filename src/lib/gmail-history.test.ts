import { describe, expect, it, vi } from 'vitest'
import {
  historyCursorIsCaughtUp,
  ingestGmailHistory,
  stubsFromHistoryRecords,
} from '@/lib/gmail-history'

describe('Gmail history ingest', () => {
  it('dedupes message ids inside one history page', () => {
    expect(stubsFromHistoryRecords([
      { id: '10', messagesAdded: [{ message: { id: 'msg-1', threadId: 't-1' } }] },
      { id: '11', messagesAdded: [{ message: { id: 'msg-1', threadId: 't-1' } }, { message: { id: 'msg-2', threadId: 't-2' } }] },
    ])).toEqual([
      { id: 'msg-1', threadId: 't-1' },
      { id: 'msg-2', threadId: 't-2' },
    ])
  })

  it('does not list history when the notification is already at the stored cursor', async () => {
    const fetchImpl = vi.fn()
    const ingestStubs = vi.fn()
    const result = await ingestGmailHistory({
      userEmail: 'ernest@savingkc.com',
      accessToken: 'token',
      startHistoryId: '200',
      notificationHistoryId: '200',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ingestStubs,
    })
    expect(historyCursorIsCaughtUp('200', '200')).toBe(true)
    expect(result.mode).toBe('caught_up')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(ingestStubs).not.toHaveBeenCalled()
  })

  it('imports added inbox messages through the shared ingest path', async () => {
    const ingestStubs = vi.fn().mockResolvedValue({ scanned: 1, matched: 1, inserted: 1 })
    const fetchImpl = (async (url: string) => {
      expect(url).toContain('/users/me/history?')
      expect(url).toContain('startHistoryId=100')
      expect(url).not.toContain('/modify')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          historyId: '200',
          history: [{
            id: '200',
            messagesAdded: [
              { message: { id: 'msg-1', threadId: 't-1' } },
              { message: { id: 'msg-1', threadId: 't-1' } },
            ],
          }],
        }),
      }
    }) as typeof fetch
    const result = await ingestGmailHistory({
      userEmail: 'ernest@savingkc.com',
      accessToken: 'token',
      startHistoryId: '100',
      notificationHistoryId: '200',
      fetchImpl,
      ingestStubs,
    })
    expect(result).toMatchObject({ mode: 'history', historyId: '200', inserted: 1 })
    expect(ingestStubs).toHaveBeenCalledWith('token', 'ernest@savingkc.com', [
      { id: 'msg-1', threadId: 't-1' },
    ])
  })

  it('keeps the cursor on the last imported record when a notification is too large for one pass', async () => {
    const history = Array.from({ length: 45 }, (_, index) => ({
      id: String(100 + index),
      messagesAdded: [{ message: { id: `msg-${index}`, threadId: `t-${index}` } }],
    }))
    const ingestStubs = vi.fn().mockResolvedValue({ scanned: 40, matched: 0, inserted: 0 })
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ historyId: '9999', history, nextPageToken: 'more' }),
    })) as unknown as typeof fetch
    const result = await ingestGmailHistory({
      userEmail: 'ernest@savingkc.com',
      accessToken: 'token',
      startHistoryId: '90',
      notificationHistoryId: '9999',
      fetchImpl,
      ingestStubs,
    })
    const stubs = ingestStubs.mock.calls[0][2] as Array<{ id: string }>
    expect(stubs).toHaveLength(40)
    expect(result).toMatchObject({ mode: 'history_partial', historyId: '139' })
  })

  it('falls back to the pull sync when Gmail expires the history cursor', async () => {
    const syncFallback = vi.fn().mockResolvedValue({ scanned: 2, matched: 1, inserted: 0 })
    const fetchImpl = (async (url: string) => {
      if (url.includes('/history?')) return { ok: false, status: 404, json: async () => ({}) }
      expect(url).toContain('/users/me/profile')
      return { ok: true, status: 200, json: async () => ({ historyId: '900' }) }
    }) as typeof fetch
    const result = await ingestGmailHistory({
      userEmail: 'ernest@savingkc.com',
      accessToken: 'token',
      startHistoryId: '1',
      notificationHistoryId: '900',
      fetchImpl,
      syncFallback,
    })
    expect(syncFallback).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ mode: 'fallback_sync', historyId: '900', scanned: 2, inserted: 0 })
  })
})
