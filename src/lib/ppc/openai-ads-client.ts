type OpenAIAdsEventName = 'page_viewed' | 'lead_created' | 'appointment_scheduled'

type OpenAIAdsEventPayload = {
  type: 'contents' | 'customer_action'
  contents?: Array<{
    id: string
    name: string
    content_type: 'page'
  }>
}

type OpenAIAdsMeasurement = {
  eventName: OpenAIAdsEventName
  eventProps: OpenAIAdsEventPayload
  eventOptions: {
    event_id?: string
  }
}

declare global {
  interface Window {
    oaiq?: (
      command: 'measure',
      eventName: OpenAIAdsEventName,
      eventProps: OpenAIAdsEventPayload,
      eventOptions?: OpenAIAdsMeasurement['eventOptions'],
    ) => void
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function pageName(event: Record<string, unknown>): string {
  return text(event.campaign) || text(event.page_variant) || text(event.page_path) || 'Saving KC PPC'
}

function pageId(event: Record<string, unknown>): string {
  return text(event.page_variant) || text(event.page_path) || 'savingkc_ppc'
}

export function buildOpenAIAdsPixelMeasurement(
  dataLayerEvent: Record<string, unknown>,
): OpenAIAdsMeasurement | null {
  const eventName = text(dataLayerEvent.event)
  const eventId = text(dataLayerEvent.event_id) ?? undefined

  if (eventName === 'ppc_visit_started') {
    return {
      eventName: 'page_viewed',
      eventProps: {
        type: 'contents',
        contents: [
          {
            id: pageId(dataLayerEvent),
            name: pageName(dataLayerEvent),
            content_type: 'page',
          },
        ],
      },
      eventOptions: { event_id: eventId },
    }
  }

  if (eventName === 'lead_submitted') {
    return {
      eventName: 'lead_created',
      eventProps: { type: 'customer_action' },
      eventOptions: { event_id: eventId },
    }
  }

  if (eventName === 'appointment_booked') {
    return {
      eventName: 'appointment_scheduled',
      eventProps: { type: 'customer_action' },
      eventOptions: { event_id: eventId },
    }
  }

  return null
}

export function sendOpenAIAdsPixelEvent(dataLayerEvent: Record<string, unknown>) {
  if (typeof window === 'undefined' || typeof window.oaiq !== 'function') return

  const measurement = buildOpenAIAdsPixelMeasurement(dataLayerEvent)
  if (!measurement) return

  window.oaiq(
    'measure',
    measurement.eventName,
    measurement.eventProps,
    measurement.eventOptions,
  )
}
