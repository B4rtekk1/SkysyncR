import { useState, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import { saveOrderIds } from '../storage'
import type { FileSortKey, Item, ViewKey } from '../types'

export const FILE_CARD_DRAG_MIME = 'application/x-skysyncr-file-id'
export type FileCardDropPosition = 'before' | 'after'

type UseManualCardOrderingParams = {
    sortKey: FileSortKey
    setSortKey: Dispatch<SetStateAction<FileSortKey>>
    view: ViewKey
    setItems: Dispatch<SetStateAction<Item[]>>
}

function reorderByOffset(items: Item[], id: string, offset: number) {
    const fromIdx = items.findIndex((item) => item.id === id)
    const toIdx = Math.min(items.length - 1, Math.max(0, fromIdx + offset))
    if (fromIdx === -1 || fromIdx === toIdx) return items

    const next = [...items]
    const [moved] = next.splice(fromIdx, 1)
    if (!moved) return items
    next.splice(toIdx, 0, moved)
    return next
}

function getDropPosition(event: DragEvent<HTMLElement>): FileCardDropPosition {
    const rect = event.currentTarget.getBoundingClientRect()
    const isWide = rect.width > rect.height * 1.4
    const pointerOffset = isWide ? event.clientX - rect.left : event.clientY - rect.top
    const size = isWide ? rect.width : rect.height
    return pointerOffset > size / 2 ? 'after' : 'before'
}

function moveBeforeOrAfter(items: Item[], sourceId: string, targetId: string, position: FileCardDropPosition) {
    const fromIdx = items.findIndex((item) => item.id === sourceId)
    const targetIdx = items.findIndex((item) => item.id === targetId)
    if (fromIdx === -1 || targetIdx === -1 || sourceId === targetId) return items

    const next = [...items]
    const [moved] = next.splice(fromIdx, 1)
    if (!moved) return items

    const targetIdxAfterRemoval = next.findIndex((item) => item.id === targetId)
    if (targetIdxAfterRemoval === -1) return items

    const insertIdx = position === 'after' ? targetIdxAfterRemoval + 1 : targetIdxAfterRemoval
    next.splice(insertIdx, 0, moved)
    return next
}

export function useManualCardOrdering({ sortKey, setSortKey, view, setItems }: UseManualCardOrderingParams) {
    const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
    const [dropTargetId, setDropTargetId] = useState<string | null>(null)
    const [dropTargetPosition, setDropTargetPosition] = useState<FileCardDropPosition>('before')

    function handleCardDragStart(id: string, event: DragEvent<HTMLElement>) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(FILE_CARD_DRAG_MIME, id)
        event.dataTransfer.setData('text/plain', id)
        setDraggedCardId(id)
    }

    function handleCardDragEnter(id: string) {
        if (id !== draggedCardId) setDropTargetId(id)
    }

    function handleCardDragOver(id: string, event: DragEvent<HTMLElement>) {
        if (id === draggedCardId) return
        event.dataTransfer.dropEffect = 'move'
        setDropTargetId(id)
        setDropTargetPosition(getDropPosition(event))
    }

    function handleCardDragLeave(id: string) {
        setDropTargetId((prev) => (prev === id ? null : prev))
    }

    function handleCardDrop(targetId: string, event: DragEvent<HTMLElement>) {
        const sourceId = event.dataTransfer.getData(FILE_CARD_DRAG_MIME) || event.dataTransfer.getData('text/plain') || draggedCardId
        const position = getDropPosition(event)
        setDraggedCardId(null)
        setDropTargetId(null)
        setDropTargetPosition('before')
        if (!sourceId || sourceId === targetId) return

        setItems((prev) => {
            const next = moveBeforeOrAfter(prev, sourceId, targetId, position)
            if (next === prev) return prev
            saveOrderIds(view, next.map((item) => item.id))
            if (sortKey !== 'manual') setSortKey('manual')
            return next
        })
    }

    function handleCardDragEnd() {
        setDraggedCardId(null)
        setDropTargetId(null)
        setDropTargetPosition('before')
    }

    function moveCardByKeyboard(id: string, offset: number) {
        if (sortKey !== 'manual') return

        setItems((prev) => {
            const next = reorderByOffset(prev, id, offset)
            if (next === prev) return prev
            saveOrderIds(view, next.map((item) => item.id))
            return next
        })
    }

    return {
        draggedCardId,
        dropTargetId,
        dropTargetPosition,
        handleCardDragStart,
        handleCardDragEnter,
        handleCardDragOver,
        handleCardDragLeave,
        handleCardDrop,
        handleCardDragEnd,
        moveCardByKeyboard,
    }
}
