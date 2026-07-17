import { useState, type DragEvent } from 'react'
import { loadNavOrder, saveNavOrder } from '../storage'
import type { ViewKey } from '../types'

export function useNavOrdering() {
    const [navOrder, setNavOrder] = useState<ViewKey[]>(() => loadNavOrder())
    const [draggedNavKey, setDraggedNavKey] = useState<ViewKey | null>(null)
    const [dropNavTarget, setDropNavTarget] = useState<ViewKey | null>(null)

    function handleNavDragStart(key: ViewKey, e: DragEvent<HTMLElement>) {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', key)
        setDraggedNavKey(key)
    }

    function handleNavDragEnter(key: ViewKey) {
        if (key !== draggedNavKey) setDropNavTarget(key)
    }

    function handleNavDragLeave(key: ViewKey) {
        setDropNavTarget((prev) => (prev === key ? null : prev))
    }

    function handleNavDrop(targetKey: ViewKey, e: DragEvent<HTMLElement>) {
        const sourceKey = (e.dataTransfer.getData('text/plain') as ViewKey) || draggedNavKey
        setDraggedNavKey(null)
        setDropNavTarget(null)
        if (!sourceKey || sourceKey === targetKey) return

        setNavOrder((prev) => {
            const arr = [...prev]
            const fromIdx = arr.indexOf(sourceKey)
            const toIdx = arr.indexOf(targetKey)
            if (fromIdx === -1 || toIdx === -1) return prev
            const [moved] = arr.splice(fromIdx, 1)
            if (!moved) return prev
            arr.splice(toIdx, 0, moved)
            saveNavOrder(arr)
            return arr
        })
    }

    function handleNavDragEnd() {
        setDraggedNavKey(null)
        setDropNavTarget(null)
    }

    return {
        navOrder,
        draggedNavKey,
        dropNavTarget,
        handleNavDragStart,
        handleNavDragEnter,
        handleNavDragLeave,
        handleNavDrop,
        handleNavDragEnd,
    }
}
