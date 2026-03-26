// TMP-02: Favorite / Star Flag
// Night 4 Phase 1: Manual pin for high-priority leads

'use client'

import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'

interface FavoriteToggleProps {
  leadId: string
  isFavorite: boolean
  onToggle?: (isFavorite: boolean) => void
  size?: 'sm' | 'md' | 'lg'
}

export function FavoriteToggle({ leadId, isFavorite, onToggle, size = 'md' }: FavoriteToggleProps) {
  const [favorite, setFavorite] = useState(isFavorite)
  const [loading, setLoading] = useState(false)

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl',
  }

  async function handleToggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    setLoading(true)
    const newValue = !favorite

    const supabase = createClient()
    const { error } = await supabase
      .from('leads')
      .update({ is_favorite: newValue })
      .eq('id', leadId)

    if (!error) {
      setFavorite(newValue)
      onToggle?.(newValue)
    } else {
      console.error('Failed to toggle favorite:', error)
    }

    setLoading(false)
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`transition-all ${loading ? 'opacity-50 cursor-wait' : 'hover:scale-110'}`}
      title={favorite ? 'Remove from favorites' : 'Add to favorites'}
    >
      <Icon
        name={favorite ? 'star' : 'star_border'}
        className={`${sizeClasses[size]} ${
          favorite ? 'text-yellow-500' : 'text-on-surface-variant/40 hover:text-yellow-400'
        }`}
      />
    </button>
  )
}
