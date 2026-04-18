'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Icon } from '@/components/ui/icon'

export interface SortableItem {
  id: string
  node: React.ReactNode
}

interface SortableColumnProps {
  storageKey: string
  items: SortableItem[]
  className?: string
}

/**
 * Generic sortable column. Wraps each item in a drag-handle row.
 * Order is persisted to localStorage under the provided storageKey.
 * New items (not in saved order) are appended in their original position.
 */
export function SortableColumn({ storageKey, items, className }: SortableColumnProps) {
  const [order, setOrder] = useState<string[] | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as string[]
        if (Array.isArray(parsed)) setOrder(parsed)
      }
    } catch {
      /* ignore */
    }
  }, [storageKey])

  const orderedItems = useMemo(() => {
    if (!order) return items
    const byId = new Map(items.map((i) => [i.id, i]))
    const seen = new Set<string>()
    const head: SortableItem[] = []
    for (const id of order) {
      const it = byId.get(id)
      if (it) {
        head.push(it)
        seen.add(id)
      }
    }
    const tail = items.filter((i) => !seen.has(i.id))
    return [...head, ...tail]
  }, [items, order])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const currentIds = orderedItems.map((i) => i.id)
    const oldIndex = currentIds.indexOf(String(active.id))
    const newIndex = currentIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const next = arrayMove(currentIds, oldIndex, newIndex)
    setOrder(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={orderedItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className={`space-y-6 ${className ?? ''}`}>
          {orderedItems.map((item) => (
            <SortableRow key={item.id} id={item.id}>
              {item.node}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    position: 'relative',
  }

  return (
    <div ref={setNodeRef} style={style} className="group/sortable">
      {/* Drag handle — only visible on hover, positioned on the left edge */}
      <button
        {...attributes}
        {...listeners}
        className="absolute -left-4 top-2 w-7 h-7 rounded-md flex items-center justify-center opacity-0 group-hover/sortable:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10"
        style={{
          background: 'var(--ck-surface-elev)',
          border: '1px solid var(--ck-border)',
          color: 'var(--ck-text-muted)',
        }}
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <Icon name="drag_indicator" className="!text-sm" />
      </button>
      {children}
    </div>
  )
}
