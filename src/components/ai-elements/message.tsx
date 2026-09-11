'use client'

import type { ComponentProps } from 'react'
import { memo } from 'react'
import { Streamdown } from 'streamdown'

import { cn } from '@/lib/utils'

export type MessageResponseProps = ComponentProps<typeof Streamdown>

/**
 * AI Elements' Markdown-aware response renderer, intentionally kept to the
 * single primitive this CRM uses. Rich code, math, and diagram plugins stay
 * out of the customer-facing chat bundle.
 */
export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn('size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}
      {...props}
    />
  ),
  (previous, next) => previous.children === next.children && previous.isAnimating === next.isAnimating,
)

MessageResponse.displayName = 'MessageResponse'
