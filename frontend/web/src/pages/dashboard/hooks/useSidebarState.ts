import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
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

    function startSidebarResize(e: ReactMouseEvent<HTMLButtonElement>) {
        e.preventDefault()
        setSidebarHidden(false)

        function onMove(event: MouseEvent) {
            setSidebarWidth(clampSidebarWidth(event.clientX))
        }

        function onUp() {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            document.body.classList.remove('is-resizing-sidebar')
        }

        document.body.classList.add('is-resizing-sidebar')
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }

    return {
        sidebarWidth,
        sidebarHidden,
        sidebarCompact,
        setSidebarHidden,
        startSidebarResize,
    }
}
