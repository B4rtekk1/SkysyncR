import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',')

type HiddenElementState = {
    element: HTMLElement
    ariaHidden: string | null
    inert: string | null
}

type ModalA11yOptions = {
    dialogRef: RefObject<HTMLElement | null>
    onClose: () => void
    enabled?: boolean
}

function getFocusableElements(root: HTMLElement) {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
        if (element.hasAttribute('disabled')) return false
        if (element.getAttribute('aria-hidden') === 'true') return false

        const style = window.getComputedStyle(element)
        return style.visibility !== 'hidden' && style.display !== 'none'
    })
}

function hideBackgroundFromAssistiveTech(modalElement: HTMLElement) {
    const changed: HiddenElementState[] = []
    const ancestors = new Set<HTMLElement>()
    let current: HTMLElement | null = modalElement

    while (current) {
        ancestors.add(current)
        current = current.parentElement
    }

    current = modalElement
    while (current.parentElement) {
        for (const sibling of Array.from(current.parentElement.children)) {
            if (!(sibling instanceof HTMLElement)) continue
            if (sibling === current || ancestors.has(sibling) || sibling.contains(modalElement)) continue

            changed.push({
                element: sibling,
                ariaHidden: sibling.getAttribute('aria-hidden'),
                inert: sibling.getAttribute('inert'),
            })
            sibling.setAttribute('aria-hidden', 'true')
            sibling.setAttribute('inert', '')
        }
        current = current.parentElement
    }

    return () => {
        for (const { element, ariaHidden, inert } of changed) {
            if (ariaHidden === null) {
                element.removeAttribute('aria-hidden')
            } else {
                element.setAttribute('aria-hidden', ariaHidden)
            }

            if (inert === null) {
                element.removeAttribute('inert')
            } else {
                element.setAttribute('inert', inert)
            }
        }
    }
}

export function useModalA11y({ dialogRef, onClose, enabled = true }: ModalA11yOptions) {
    useEffect(() => {
        if (!enabled) return

        const dialog = dialogRef.current
        if (!dialog) return
        const activeDialog = dialog

        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const restoreBackground = hideBackgroundFromAssistiveTech(activeDialog)
        const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const focusable = getFocusableElements(activeDialog)
        const initialFocusTarget =
            activeElement && activeDialog.contains(activeElement)
                ? activeElement
                : focusable[0] ?? activeDialog

        if (!activeDialog.hasAttribute('tabindex')) {
            activeDialog.setAttribute('tabindex', '-1')
        }

        window.requestAnimationFrame(() => {
            initialFocusTarget.focus()
        })

        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
                return
            }

            if (event.key !== 'Tab') return

            const currentFocusable = getFocusableElements(activeDialog)
            if (currentFocusable.length === 0) {
                event.preventDefault()
                activeDialog.focus()
                return
            }

            const first = currentFocusable[0]
            const last = currentFocusable[currentFocusable.length - 1]
            if (!first || !last) return

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
            }
        }

        document.addEventListener('keydown', onKeyDown, true)

        return () => {
            document.removeEventListener('keydown', onKeyDown, true)
            restoreBackground()

            if (previouslyFocused?.isConnected) {
                previouslyFocused.focus()
            }
        }
    }, [dialogRef, enabled, onClose])
}
