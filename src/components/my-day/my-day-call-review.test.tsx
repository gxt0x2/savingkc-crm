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

  it('saves a preview scorecard after every current behavior is rated even with a stale saved answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ viewerEmail: 'ernest@savingkc.com', recordings: [{
        id: 'preview-local', leadName: 'Preview save test', recordingUrl: '/audio/ivr-voicemail.mp3', durationSeconds: 5, analysisSummary: null, previewLocal: true,
        reviewWorkflow: { status: 'submitted', framework: 'junior_acquisitions', score: null, submittedBy: 'preview-user', assignedReviewer: 'ernest@savingkc.com', tags: [], aiStatus: 'idle', answers: { retired_behavior: 3 } },
      }] }),
    }))

    render(<MyDayCallReview surface="scorecard" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Score Call' }))
    const dialog = await screen.findByRole('dialog', { name: 'Preview save test' })
    for (const group of within(dialog).getAllByRole('radiogroup')) fireEvent.click(within(group).getByRole('radio', { name: '0' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete Scorecard' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Preview save test' })).not.toBeInTheDocument())
    expect(window.localStorage.getItem('savingkc:preview-call-review-result:v1:preview-local')).toContain('"status":"completed"')
  })

  it('keeps the reviewer microphone live while the seller call plays', async () => {
    const gains: Array<{ gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn> }; connect: (target: unknown) => unknown; disconnect: ReturnType<typeof vi.fn> }> = []
    const track = { readyState: 'live', stop: vi.fn() }
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
    let recorderOptions: MediaRecorderOptions | undefined
    class MockAudioContext {
      state = 'running'
      currentTime = 0
      destination = {}
      resume = vi.fn()
      close = vi.fn()
      createMediaElementSource() { return { connect: (target: unknown) => target, disconnect: vi.fn() } }
      createMediaStreamDestination() { return { stream: {} as MediaStream, connect: (target: unknown) => target, disconnect: vi.fn() } }
      createMediaStreamSource() { return { connect: (target: unknown) => target, disconnect: vi.fn() } }
      createAnalyser() { return { fftSize: 512, getByteTimeDomainData: (values: Uint8Array) => values.fill(132), connect: (target: unknown) => target, disconnect: vi.fn() } }
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
      constructor(_stream: MediaStream, public options?: MediaRecorderOptions) { recorderOptions = options }
      start() { this.state = 'recording' }
      requestData() {}
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
    expect(gains[0].gain.value).toBe(0.55)
    expect(gains[1].gain.value).toBe(1.8)
    expect(recorderOptions?.audioBitsPerSecond).toBe(96_000)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: { autoGainControl: false, channelCount: 1, echoCancellation: false, noiseSuppression: false } })
    expect(screen.getByLabelText('Live microphone level')).toBeInTheDocument()
  })

  it('rejects an empty browser recording instead of showing false completion', async () => {
    const track = { readyState: 'live', stop: vi.fn() }
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
    class MockAudioContext {
      state = 'running'
      currentTime = 0
      destination = {}
      resume = vi.fn()
      close = vi.fn()
      createMediaElementSource() { return { connect: (target: unknown) => target, disconnect: vi.fn() } }
      createMediaStreamDestination() { return { stream: {} as MediaStream, connect: (target: unknown) => target, disconnect: vi.fn() } }
      createMediaStreamSource() { return { connect: (target: unknown) => target, disconnect: vi.fn() } }
      createAnalyser() { return { fftSize: 512, getByteTimeDomainData: (values: Uint8Array) => values.fill(128), connect: (target: unknown) => target, disconnect: vi.fn() } }
      createGain() { return { gain: { value: 0, setValueAtTime: vi.fn() }, connect: (target: unknown) => target, disconnect: vi.fn() } }
    }
    class EmptyMediaRecorder {
      static isTypeSupported = vi.fn(() => true)
      state = 'inactive'
      mimeType = 'audio/webm;codecs=opus'
      ondataavailable: ((event: BlobEvent) => void) | null = null
      onstop: (() => void) | null = null
      start() { this.state = 'recording' }
      requestData() {}
      stop() { this.state = 'inactive'; this.onstop?.() }
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ viewerEmail: 'ernest@savingkc.com', recordings: [{
        id: 'call-empty', leadName: 'Empty Recording', recordingUrl: '/api/recordings/RE-empty', durationSeconds: 184, analysisSummary: null,
        reviewWorkflow: { status: 'submitted', framework: 'junior_acquisitions', score: null, submittedBy: 'casey@savingkc.com', assignedReviewer: 'ernest@savingkc.com', tags: [], aiStatus: 'idle' },
      }] }),
    }))
    vi.stubGlobal('MediaRecorder', EmptyMediaRecorder)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
    vi.stubGlobal('AudioContext', MockAudioContext)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<MyDayCallReview surface="scorecard" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Score Call' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start Review' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Finish Review' }))

    expect(await screen.findByText('No coaching audio was captured. Check the microphone, then record the review again.')).toBeInTheDocument()
    expect(screen.queryByText('Review recording complete')).not.toBeInTheDocument()
  })
})
