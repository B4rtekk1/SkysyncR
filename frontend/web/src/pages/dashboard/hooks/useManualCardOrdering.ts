import { useState, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import { saveOrderIds } from '../storage'
import type { FileSortKey, Item, ViewKey } from '../types'

export const FILE_CARD_DRAG_MIME = 'application/x-skysyncr-file-id'

type UseManualCardOrderingParams = {
    sortKey: FileSortKey
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

export function useManualCardOrdering({ sortKey, view, setItems }: UseManualCardOrderingParams) {
    const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
    const [dropTargetId, setDropTargetId] = useState<string | null>(null)

    function handleCardDragStart(id: string, event: DragEvent<HTMLElement>) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(FILE_CARD_DRAG_MIME, id)
        event.dataTransfer.setData('text/plain', id)
        setDraggedCardId(id)
    }

    function handleCardDragEnter(id: string) {
        if (id !== draggedCardId) setDropTargetId(id)
    }

    function handleCardDragLeave(id: string) {
        setDropTargetId((prev) => (prev === id ? null : prev))
    }

    function handleCardDrop(targetId: string, event: DragEvent<HTMLElement>) {
        const sourceId = event.dataTransfer.getData(FILE_CARD_DRAG_MIME) || event.dataTransfer.getData('text/plain') || draggedCardId
        setDraggedCardId(null)
        setDropTargetId(null)
        if (sortKey !== 'manual') return
        if (!sourceId || sourceId === targetId) return

        setItems((prev) => {
            const arr = [...prev]
            const fromIdx = arr.findIndex((item) => item.id === sourceId)
            const toIdx = arr.findIndex((item) => item.id === targetId)
            if (fromIdx === -1 || toIdx === -1) return prev
            const [moved] = arr.splice(fromIdx, 1)
            if (!moved) return prev
            arr.splice(toIdx, 0, moved)
            saveOrderIds(view, arr.map((item) => item.id))
            return arr
        })
    }

    function handleCardDragEnd() {
        setDraggedCardId(null)
        setDropTargetId(null)
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
        handleCardDragStart,
        handleCardDragEnter,
        handleCardDragLeave,
        handleCardDrop,
        handleCardDragEnd,
        moveCardByKeyboard,
    }
}
