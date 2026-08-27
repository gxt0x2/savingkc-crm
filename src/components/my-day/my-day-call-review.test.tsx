/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MyDayCallReview } from './my-day-call-review'

describe('MyDayCallReview submitter notes', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('shows the submitter note in the queue and inside the grader', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        viewerEmail: 'ernest@savingkc.com',
        recordings: [{
          id: 'call-42',
          leadName: 'Gunner Byrd',
          recordingUrl: '/api/recordings/RE42',
          durationSeconds: 184,
          analysisSummary: null,
          reviewWorkflow: {
            status: 'submitted',
            framework: 'junior_acquisitions',
            score: null,
            submittedBy: 'casey@savingkc.com',
            assignedReviewer: 'ernest@savingkc.com',
            submissionNote: 'Listen for the pricing objection near the end.',
            tags: [],
            aiStatus: 'idle',
          },
        }],
      }),
    }))

    render(<MyDayCallReview surface="scorecard" />)

    expect(await screen.findByText('Listen for the pricing objection near the end.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Score Call' }))

    const dialog = await screen.findByRole('dialog', { name: 'Gunner Byrd' })
    expect(within(dialog).getByText('Note to reviewer')).toBeInTheDocument()
    expect(within(dialog).getByText('Listen for the pricing objection near the end.')).toBeInTheDocument()
    expect(within(dialog).getByText('Submitted by casey@savingkc.com')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Restart' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Playback speed')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Playback elapsed and total time')).toHaveTextContent('0:00 / 3:04')
    expect(dialog.parentElement).toHaveClass('z-[70]')
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  })

  it('keeps the reviewer microphone live while the seller call plays', async () => {
    const gains: Array<{ gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn> }; connect: (target: unknown) => unknown; disconnect: ReturnType<typeof vi.fn> }> = []
    const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
    class MockAudioContext {
      state = 'running'
      currentTime = 0
      destination = {}
      resume = vi.fn()
      close = vi.fn()
      createMediaElementSource() { return { connect: (target: unknown) => target, disconnect: vi.fn() } }
      createMediaStreamDestination() { return { stream: {} as MediaStream, connect: (target: unknown) => target, disconnect: vi.fn() } }
      createMediaStreamSource() { return { connect: (target: unknown) => target, disconnect: vi.fn() } }
      createGain() {
        const node = { gain: { value: 0, setValueAtTime: vi.fn() }, connect: (target: unknown) => target, disconnect: vi.fn() }
        gains.push(node)
        return node
      }
    }
    class MockMediaRecorder {
      static isTypeSupported = vi.fn(() => true)
      state = 'inactive'
      mimeType = 'audio/webm;codecs=opus'
      ondataavailable: ((event: BlobEvent) => void) | null = null
      onstop: (() => void) | null = null
      constructor(_stream: MediaStream, public options?: MediaRecorderOptions) {}
      start() { this.state = 'recording' }
      stop() { this.state = 'inactive'; this.onstop?.() }
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ viewerEmail: 'ernest@savingkc.com', recordings: [{
        id: 'call-42', leadName: 'Gunner Byrd', recordingUrl: '/api/recordings/RE42', durationSeconds: 184, analysisSummary: null,
        reviewWorkflow: { status: 'submitted', framework: 'junior_acquisitions', score: null, submittedBy: 'casey@savingkc.com', assignedReviewer: 'ernest@savingkc.com', tags: [], aiStatus: 'idle' },
      }] }),
    }))
    vi.stubGlobal('MediaRecorder', MockMediaRecorder)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
    vi.stubGlobal('AudioContext', MockAudioContext)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()

    render(<MyDayCallReview surface="scorecard" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Score Call' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start Review' }))

    expect(await screen.findByText('The seller call and your microphone are both recording.')).toBeInTheDocument()
    expect(gains).toHaveLength(2)
    expect(gains[1].gain.value).toBe(1)
  })
})
