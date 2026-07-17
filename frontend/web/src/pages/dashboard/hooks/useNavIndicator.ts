import { useCallback, useEffect, useRef, useState } from 'react'
import type { NavIndicator, ViewKey } from '../types'

export function useNavIndicator(
    view: ViewKey,
    navOrder: ViewKey[],
    sidebarWidth: number,
    sidebarHidden: boolean,
) {
    const navListRef = useRef<HTMLElement>(null)
    const navItemRefs = useRef<Partial<Record<ViewKey, HTMLButtonElement>>>({})
    const [navIndicator, setNavIndicator] = useState<NavIndicator>({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        visible: false,
    })
    const [navIndicatorPulling, setNavIndicatorPulling] = useState(false)
    const frameRef = useRef<number | null>(null)

    const updateNavIndicator = useCallback(() => {
        const nav = navListRef.current
        const activeItem = navItemRefs.current[view]
        if (!nav || !activeItem || sidebarHidden) {
            setNavIndicator((prev) => (prev.visible ? { ...prev, visible: false } : prev))
            return
        }

        const navRect = nav.getBoundingClientRect()
        const itemRect = activeItem.getBoundingClientRect()
        const nextIndicator = {
            x: itemRect.left - navRect.left,
            y: itemRect.top - navRect.top,
            width: itemRect.width,
            height: itemRect.height,
            visible: true,
        }

        setNavIndicator((prev) =>
            prev.x === nextIndicator.x &&
            prev.y === nextIndicator.y &&
            prev.width === nextIndicator.width &&
            prev.height === nextIndicator.height &&
            prev.visible === nextIndicator.visible
                ? prev
                : nextIndicator,
        )
    }, [sidebarHidden, view])

    const scheduleNavIndicatorUpdate = useCallback(() => {
        if (frameRef.current !== null) return

        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null
            updateNavIndicator()
        })
    }, [updateNavIndicator])

    useEffect(() => {
        scheduleNavIndicatorUpdate()
        window.addEventListener('resize', scheduleNavIndicatorUpdate)
        return () => {
            window.removeEventListener('resize', scheduleNavIndicatorUpdate)
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current)
                frameRef.current = null
            }
        }
    }, [navOrder, scheduleNavIndicatorUpdate, sidebarWidth])

    useEffect(() => {
        let pullFrame: number | undefined
        const frame = requestAnimationFrame(() => {
            setNavIndicatorPulling(false)
            pullFrame = requestAnimationFrame(() => setNavIndicatorPulling(true))
        })
        const timeout = window.setTimeout(() => setNavIndicatorPulling(false), 540)

        return () => {
            cancelAnimationFrame(frame)
            if (pullFrame) cancelAnimationFrame(pullFrame)
            window.clearTimeout(timeout)
        }
    }, [view])

    return {
        navListRef,
        navItemRefs,
        navIndicator,
        navIndicatorPulling,
    }
}
