import { useState, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import { saveOrderIds } from '../storage'
import type { FileSortKey, Item, ViewKey } from '../types'

type UseManualCardOrderingParams = {
    sortKey: FileSortKey
    view: ViewKey
    setItems: Dispatch<SetStateAction<Item[]>>
}

export function useManualCardOrdering({ sortKey, view, setItems }: UseManualCardOrderingParams) {
    const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
    const [dropTargetId, setDropTargetId] = useState<string | null>(null)

    function handleCardDragStart(id: string, event: DragEvent<HTMLElement>) {
        event.dataTransfer.effectAllowed = 'move'
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
        const sourceId = event.dataTransfer.getData('text/plain') || draggedCardId
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
            arr.splice(toIdx, 0, moved)
            saveOrderIds(view, arr.map((item) => item.id))
            return arr
        })
    }

    function handleCardDragEnd() {
        setDraggedCardId(null)
        setDropTargetId(null)
    }

    return {
        draggedCardId,
        dropTargetId,
        handleCardDragStart,
        handleCardDragEnter,
        handleCardDragLeave,
        handleCardDrop,
        handleCardDragEnd,
    }
}
