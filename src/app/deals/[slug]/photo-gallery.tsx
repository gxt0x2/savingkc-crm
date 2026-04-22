'use client'

import { useState, useEffect, useCallback } from 'react'

interface PhotoGalleryProps {
  photos: string[]
}

export default function PhotoGallery({ photos }: PhotoGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [gridView, setGridView] = useState(false)

  const openLightbox = useCallback((index: number) => {
    setCurrentIndex(index)
    setGridView(false)
    setLightboxOpen(true)
  }, [])

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false)
  }, [])

  const goNext = useCallback(() => {
    setCurrentIndex(i => (i + 1) % photos.length)
  }, [photos.length])

  const goPrev = useCallback(() => {
    setCurrentIndex(i => (i - 1 + photos.length) % photos.length)
  }, [photos.length])

  // Keyboard navigation
  useEffect(() => {
    if (!lightboxOpen) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeLightbox()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [lightboxOpen, closeLightbox, goNext, goPrev])

  // Lock body scroll when lightbox is open
  useEffect(() => {
    if (lightboxOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [lightboxOpen])

  if (photos.length === 0) return null

  // Gallery layout: 1 hero (left, tall) + up to 4 small (right grid)
  const hero = photos[0]
  const thumbs = photos.slice(1, 5)
  const remaining = photos.length - 5

  return (
    <>
      {/* Gallery Grid */}
      <div className="mb-6 relative">
        {photos.length === 1 ? (
          <div
            className="rounded-xl overflow-hidden cursor-pointer"
            onClick={() => openLightbox(0)}
          >
            <img src={hero} alt="Property" className="w-full h-[400px] object-cover" />
          </div>
        ) : photos.length === 2 ? (
          <div className="grid grid-cols-2 gap-2 rounded-xl overflow-hidden">
            {photos.slice(0, 2).map((url, i) => (
              <div key={i} className="cursor-pointer" onClick={() => openLightbox(i)}>
                <img src={url} alt={`Property ${i + 1}`} className="w-full h-[350px] object-cover" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 grid-rows-2 gap-2 rounded-xl overflow-hidden" style={{ height: '420px' }}>
            {/* Hero photo */}
            <div
              className="col-span-2 row-span-2 cursor-pointer relative group"
              onClick={() => openLightbox(0)}
            >
              <img src={hero} alt="Property" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
            </div>
            {/* Secondary photos */}
            {thumbs.map((url, i) => (
              <div
                key={i}
                className="col-span-1 row-span-1 cursor-pointer relative group"
                onClick={() => openLightbox(i + 1)}
              >
                <img src={url} alt={`Property ${i + 2}`} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              </div>
            ))}
          </div>
        )}

        {/* Show all photos button */}
        {photos.length > 5 && (
          <button
            onClick={() => { setGridView(true); setLightboxOpen(true) }}
            className="absolute bottom-4 right-4 bg-white/95 backdrop-blur text-gray-900 text-sm font-semibold px-4 py-2 rounded-lg shadow-md hover:bg-white transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            Show all {photos.length} photos
          </button>
        )}
        {photos.length >= 3 && photos.length <= 5 && (
          <button
            onClick={() => { setGridView(true); setLightboxOpen(true) }}
            className="absolute bottom-4 right-4 bg-white/95 backdrop-blur text-gray-900 text-sm font-semibold px-4 py-2 rounded-lg shadow-md hover:bg-white transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            View all photos
          </button>
        )}
      </div>

      {/* Lightbox Modal */}
      {lightboxOpen && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col">
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">
                {gridView ? `${photos.length} Photos` : `${currentIndex + 1} / ${photos.length}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setGridView(!gridView)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title={gridView ? 'Single view' : 'Grid view'}
              >
                {gridView ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                )}
              </button>
              <button
                onClick={closeLightbox}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {gridView ? (
            /* Grid View */
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-w-6xl mx-auto">
                {photos.map((url, i) => (
                  <div
                    key={i}
                    className="cursor-pointer aspect-[4/3] rounded-lg overflow-hidden"
                    onClick={() => { setCurrentIndex(i); setGridView(false) }}
                  >
                    <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover hover:opacity-80 transition-opacity" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Single View */
            <div className="flex-1 flex items-center justify-center relative px-16">
              {/* Prev button */}
              <button
                onClick={goPrev}
                className="absolute left-4 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-white"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              {/* Image */}
              <img
                src={photos[currentIndex]}
                alt={`Photo ${currentIndex + 1}`}
                className="max-h-[80vh] max-w-full object-contain rounded-lg"
              />

              {/* Next button */}
              <button
                onClick={goNext}
                className="absolute right-4 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-white"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}

          {/* Bottom thumbnails strip (single view only) */}
          {!gridView && photos.length > 1 && (
            <div className="px-4 py-3 overflow-x-auto">
              <div className="flex gap-2 justify-center">
                {photos.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentIndex(i)}
                    className={`w-16 h-12 rounded-md overflow-hidden flex-shrink-0 transition-all ${
                      i === currentIndex ? 'ring-2 ring-white opacity-100' : 'opacity-50 hover:opacity-75'
                    }`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
