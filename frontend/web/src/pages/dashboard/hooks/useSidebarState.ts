import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
    COMPACT_SIDEBAR_WIDTH,
    SIDEBAR_HIDDEN_STORAGE_KEY,
    SIDEBAR_WIDTH_STORAGE_KEY,
    STORAGE_COMPACT_SIDEBAR_WIDTH,
    clampSidebarWidth,
    loadSidebarHidden,
    loadSidebarWidth,
} from '../storage'

export function useSidebarState() {
    const [sidebarWidth, setSidebarWidth] = useState(() => loadSidebarWidth())
    const [sidebarHidden, setSidebarHidden] = useState(() => loadSidebarHidden())
    const resizeFrameRef = useRef<number | null>(null)
    const pendingSidebarWidthRef = useRef(sidebarWidth)
    const sidebarCompact = !sidebarHidden && sidebarWidth <= COMPACT_SIDEBAR_WIDTH
    const sidebarStorageCompact = !sidebarHidden && sidebarWidth <= STORAGE_COMPACT_SIDEBAR_WIDTH

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            try {
                localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth))
            } catch {
                // ignore storage failures (e.g. private browsing)
            }
        }, 120)

        return () => window.clearTimeout(timeout)
    }, [sidebarWidth])

    useEffect(() => {
        return () => {
            if (resizeFrameRef.current !== null) {
                cancelAnimationFrame(resizeFrameRef.current)
            }
            document.body.classList.remove('is-resizing-sidebar')
        }
    }, [])

    function commitSidebarWidth(width: number) {
        pendingSidebarWidthRef.current = clampSidebarWidth(width)
        if (resizeFrameRef.current !== null) return

        resizeFrameRef.current = requestAnimationFrame(() => {
            resizeFrameRef.current = null
            setSidebarWidth((current) => (
                current === pendingSidebarWidthRef.current ? current : pendingSidebarWidthRef.current
            ))
        })
    }

    function persistSidebarWidth(width: number) {
        try {
            localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width))
        } catch {
            // ignore storage failures (e.g. private browsing)
        }
    }

    useEffect(() => {
        try {
            localStorage.setItem(SIDEBAR_HIDDEN_STORAGE_KEY, String(sidebarHidden))
        } catch {
            // ignore storage failures (e.g. private browsing)
        }
    }, [sidebarHidden])

    function startSidebarResize(e: ReactPointerEvent<HTMLButtonElement>) {
        e.preventDefault()
        const handle = e.currentTarget
        setSidebarHidden(false)
        handle.setPointerCapture(e.pointerId)
        commitSidebarWidth(e.clientX)

        function onMove(event: PointerEvent) {
            commitSidebarWidth(event.clientX)
        }

        function onUp(event: PointerEvent) {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onUp)
            document.body.classList.remove('is-resizing-sidebar')
            setSidebarWidth(pendingSidebarWidthRef.current)
            persistSidebarWidth(pendingSidebarWidthRef.current)
            if (handle.hasPointerCapture(event.pointerId)) {
                handle.releasePointerCapture(event.pointerId)
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
        sidebarStorageCompact,
        setSidebarHidden,
        startSidebarResize,
        resizeSidebarWithKeyboard,
    }
}
