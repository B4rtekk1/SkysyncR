import { useEffect, useRef, useState } from 'react'
import { LAYOUT_SWITCH_MS, loadLayoutMode, saveLayoutMode } from '../storage'
import type { LayoutMode } from '../types'

export function useLayoutModeSwitch() {
    const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => loadLayoutMode())
    const [layoutSwitchTarget, setLayoutSwitchTarget] = useState<LayoutMode | null>(null)
    const layoutSwitchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        return () => {
            if (layoutSwitchTimeoutRef.current) clearTimeout(layoutSwitchTimeoutRef.current)
        }
    }, [])

    function changeLayoutMode(mode: LayoutMode) {
        if (mode === layoutMode) return
        if (layoutSwitchTimeoutRef.current) clearTimeout(layoutSwitchTimeoutRef.current)

        setLayoutSwitchTarget(mode)
        setLayoutMode(mode)
        saveLayoutMode(mode)

        layoutSwitchTimeoutRef.current = setTimeout(() => {
            setLayoutSwitchTarget(null)
            layoutSwitchTimeoutRef.current = null
        }, LAYOUT_SWITCH_MS)
    }

    return {
        layoutMode,
        layoutSwitchTarget,
        changeLayoutMode,
    }
}
