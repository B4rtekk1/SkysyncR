import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
    COMPACT_SIDEBAR_WIDTH,
    SIDEBAR_HIDDEN_STORAGE_KEY,
    SIDEBAR_WIDTH_STORAGE_KEY,
    clampSidebarWidth,
    loadSidebarHidden,
    loadSidebarWidth,
} from '../storage'

export function useSidebarState() {
    const [sidebarWidth, setSidebarWidth] = useState(() => loadSidebarWidth())
    const [sidebarHidden, setSidebarHidden] = useState(() => loadSidebarHidden())
    const sidebarCompact = !sidebarHidden && sidebarWidth <= COMPACT_SIDEBAR_WIDTH

    useEffect(() => {
        try {
            localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth))
        } catch {
            // ignore storage failures (e.g. private browsing)
        }
    }, [sidebarWidth])

    useEffect(() => {
        try {
            localStorage.setItem(SIDEBAR_HIDDEN_STORAGE_KEY, String(sidebarHidden))
        } catch {
            // ignore storage failures (e.g. private browsing)
        }
    }, [sidebarHidden])

    function startSidebarResize(e: ReactPointerEvent<HTMLButtonElement>) {
        e.preventDefault()
        setSidebarHidden(false)
        e.currentTarget.setPointerCapture(e.pointerId)

        function onMove(event: PointerEvent) {
            setSidebarWidth(clampSidebarWidth(event.clientX))
        }

        function onUp(event: PointerEvent) {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onUp)
            document.body.classList.remove('is-resizing-sidebar')
            if (e.currentTarget.hasPointerCapture(event.pointerId)) {
                e.currentTarget.releasePointerCapture(event.pointerId)
            }
        }

        document.body.classList.add('is-resizing-sidebar')
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
    }

    function resizeSidebarWithKeyboard(e: ReactKeyboardEvent<HTMLButtonElement>) {
        const step = e.shiftKey ? 24 : 12
        const direction = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
        if (direction === 0) return

        e.preventDefault()
        setSidebarHidden(false)
        setSidebarWidth((current) => clampSidebarWidth(current + direction * step))
    }

    return {
        sidebarWidth,
        sidebarHidden,
        sidebarCompact,
        setSidebarHidden,
        startSidebarResize,
        resizeSidebarWithKeyboard,
    }
}
