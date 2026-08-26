'use client'

import Image from 'next/image'

interface DealGalleryImageProps {
  src: string
  originalUrl?: string
  alt: string
  sizes: string
  className: string
  width?: number
  height?: number
  loading?: 'eager' | 'lazy'
  fetchPriority?: 'high' | 'low' | 'auto'
  onUnavailable?: () => void
}

export function DealGalleryImage({
  src,
  originalUrl,
  alt,
  sizes,
  className,
  width,
  height,
  loading,
  fetchPriority,
  onUnavailable,
}: DealGalleryImageProps) {
  const dimensions = width && height ? { width, height } : { fill: true as const }

  return (
    <Image
      {...dimensions}
      src={src}
      alt={alt}
      sizes={sizes}
      unoptimized
      className={className}
      decoding="async"
      loading={loading}
      fetchPriority={fetchPriority}
      onError={(event) => {
        if (onUnavailable) {
          onUnavailable()
          return
        }
        if (!originalUrl || event.currentTarget.dataset.fallbackOriginal === '1') return
        event.currentTarget.dataset.fallbackOriginal = '1'
        event.currentTarget.src = originalUrl
      }}
    />
  )
}
