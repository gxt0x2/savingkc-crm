'use client'

import { type CSSProperties } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { ContactSmartList, ContactSmartListNavigationId } from '@/lib/contact-smart-lists'

type SmartListTone = { active: string; count: string }
type SmartListItem = { id: ContactSmartListNavigationId; label: string }

export interface SortableSmartListTabsProps {
  items: SmartListItem[]
  order: ContactSmartListNavigationId[]
  counts: Record<ContactSmartList, number>
  activeId: ContactSmartList
  tones: Record<ContactSmartList, SmartListTone>
  onSelect: (id: ContactSmartListNavigationId) => void
  onOrderChange: (order: ContactSmartListNavigationId[]) => void
}

export function SortableSmartListTabs({
  items,
  order,
  counts,
  activeId,
  tones,
  onSelect,
  onOrderChange,
}: SortableSmartListTabsProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const draggedId = event.active.id as ContactSmartListNavigationId
    const overId = event.over?.id as ContactSmartListNavigationId | undefined
    if (!overId || draggedId === overId) return

    const currentIndex = order.indexOf(draggedId)
    const nextIndex = order.indexOf(overId)
    if (currentIndex === -1 || nextIndex === -1) return
    onOrderChange(arrayMove(order, currentIndex, nextIndex))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order} strategy={horizontalListSortingStrategy}>
        <nav className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto" aria-label="Pipeline smart lists">
          {items.map(({ id, label }) => (
            <SortableSmartListTab
              key={id}
              id={id}
              label={label}
              count={counts[id]}
              active={activeId === id}
              tone={tones[id]}
              onSelect={() => onSelect(id)}
            />
          ))}
        </nav>
      </SortableContext>
    </DndContext>
  )
}

function SortableSmartListTab({
  id,
  label,
  count,
  active,
  tone,
  onSelect,
}: {
  id: ContactSmartListNavigationId
  label: string
  count: number
  active: boolean
  tone: SmartListTone
  onSelect: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      {...attributes}
      {...listeners}
      onClick={onSelect}
      aria-label={`${label} ${count}`}
      aria-current={active ? 'page' : undefined}
      title={`Open ${label}. Drag the tab itself to reorder.`}
      className={`shrink-0 touch-none border-b-[3px] px-3 py-3 text-sm font-semibold transition-colors ${active ? tone.active : 'border-transparent text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]'} ${isDragging ? 'cursor-grabbing rounded-t-lg bg-[var(--crm-surface)] shadow-lg' : 'cursor-grab'}`}
    >
      {label}{' '}
      <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${active ? tone.count : 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'}`}>
        {count}
      </span>
    </button>
  )
}
