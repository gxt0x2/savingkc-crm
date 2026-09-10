/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AssistantMessage, splitAssistantMessage } from './assistant-message'

describe('AssistantMessage progressive disclosure', () => {
  it('shows a compact response without a details control', () => {
    render(<AssistantMessage content="Call the overdue seller first." sources={[]} />)

    expect(screen.getByText('Call the overdue seller first.')).toBeVisible()
    expect(screen.queryByText('Show details')).not.toBeInTheDocument()
  })

  it('keeps the beginning visible and places a long remainder behind details', () => {
    const opening = `${'Decision-relevant evidence. '.repeat(45)}\n`
    const remainder = 'Supporting audit detail that should not crowd the default answer.'
    const message = splitAssistantMessage(`${opening}${remainder}`)

    expect(message.preview.length).toBeLessThanOrEqual(850)
    expect(message.details).toContain(remainder)

    render(<AssistantMessage content={`${opening}${remainder}`} sources={[]} />)
    expect(screen.getByText('Read the supporting detail')).toBeVisible()
    expect(screen.getByText(/Supporting audit detail/)).not.toBeVisible()
  })

  it('collapses evidence links under a source count', () => {
    render(<AssistantMessage content="The queue has five priorities." sources={[
      { name: 'Attention queue', url: '/tasks' },
      { name: 'Operating snapshot', url: '/reports' },
    ]} />)

    expect(screen.getByText('Evidence · 2 sources')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Attention queue' })).not.toBeVisible()
  })

  it('renders Markdown as human-readable hierarchy instead of literal punctuation', () => {
    const { container } = render(<AssistantMessage content="**Priority:** Call Howard today." sources={[]} />)

    expect(screen.getByText('Priority:')).toBeVisible()
    expect(container).not.toHaveTextContent('**')
  })
})
