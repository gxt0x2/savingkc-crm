/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CallReviewAudioPlayer, formatPlaybackTime } from './call-review-audio-player'

describe('CallReviewAudioPlayer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows elapsed and known total time without non-finite values', () => {
    render(<CallReviewAudioPlayer src="/api/recordings/RE123" knownDuration={1329} />)

    expect(screen.getByLabelText('Playback elapsed and total time')).toHaveTextContent('0:00 / 22:09')
    expect(formatPlaybackTime(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatPlaybackTime(Number.NaN)).toBe('0:00')
  })

  it('can restart the recording and change playback speed', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    render(<CallReviewAudioPlayer src="/api/recordings/RE123" knownDuration={1329} />)
    const audio = screen.getByLabelText('Original call recording') as HTMLAudioElement
    audio.currentTime = 38

    fireEvent.change(screen.getByLabelText('Playback speed'), { target: { value: '1.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))

    expect(audio.playbackRate).toBe(1.5)
    expect(audio.currentTime).toBe(0)
    expect(play).toHaveBeenCalled()
  })
})
