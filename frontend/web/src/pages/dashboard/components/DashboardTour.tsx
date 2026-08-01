import { useCallback, useEffect, useMemo, useState } from 'react'

type TourStep = {
    target: string
    eyebrow: string
    title: string
    description: string
}

const STEPS: TourStep[] = [
    {
        target: '[data-tour="sidebar"]',
        eyebrow: 'Step 1 of 5',
        title: 'Your sidebar is the main navigation',
        description: 'Use it to switch between all files, favourites, trash, groups and calendar. The top control hides the sidebar, its edge changes the width, and the bar at the bottom shows your storage usage.',
    },
    {
        target: '[data-tour="search"]',
        eyebrow: 'Step 2 of 5',
        title: 'Find anything quickly',
        description: 'Search your encrypted vault from here. Press “/” at any time to focus the search field.',
    },
    {
        target: '[data-tour="toolbar"]',
        eyebrow: 'Step 3 of 5',
        title: 'Add and organise content',
        description: 'Create files and folders, upload content, then use sorting, filters and the layout switcher to shape your view.',
    },
    {
        target: '[data-tour="folder-card"]',
        eyebrow: 'Step 4 of 5',
        title: 'Open a folder to go deeper',
        description: 'Click a folder card to open it. The actions on the card let you rename, share, download or move it to the trash.',
    },
    {
        target: '[data-tour="account"]',
        eyebrow: 'Step 5 of 5',
        title: 'Manage your account',
        description: 'Open your avatar for account actions. Settings in the sidebar contain your profile, security and application preferences.',
    },
]

const TOUR_KEY_PREFIX = 'dashboard-tour-completed:'

function getTargetRect(selector: string): DOMRect | null {
    const element = document.querySelector<HTMLElement>(selector)
    return element?.getBoundingClientRect() ?? null
}

export function DashboardTour({ userId }: { userId: string }) {
    const storageKey = useMemo(() => `${TOUR_KEY_PREFIX}${userId}`, [userId])
    const [stepIndex, setStepIndex] = useState<number | null>(() => {
        try {
            return window.localStorage.getItem(storageKey) === 'true' ? null : 0
        } catch {
            return 0
        }
    })
    const [targetRect, setTargetRect] = useState<DOMRect | null>(null)

    const closeTour = useCallback(() => {
        try {
            window.localStorage.setItem(storageKey, 'true')
        } catch {
            // The tour still works when storage is unavailable.
        }
        setStepIndex(null)
    }, [storageKey])

    useEffect(() => {
        if (stepIndex === null) return

        const updateTarget = () => setTargetRect(getTargetRect(STEPS[stepIndex]?.target ?? ''))
        updateTarget()
        window.addEventListener('resize', updateTarget)
        window.addEventListener('scroll', updateTarget, true)
        return () => {
            window.removeEventListener('resize', updateTarget)
            window.removeEventListener('scroll', updateTarget, true)
        }
    }, [stepIndex])

    useEffect(() => {
        if (stepIndex === null) return

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeTour()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [closeTour, stepIndex])

    if (stepIndex === null) return null

    const step = STEPS[stepIndex]!
    const isLast = stepIndex === STEPS.length - 1
    const spotlightStyle = targetRect
        ? {
              left: targetRect.left - 8,
              top: targetRect.top - 8,
              width: targetRect.width + 16,
              height: targetRect.height + 16,
          }
        : undefined

    return (
        <div className="dashboard-tour" role="dialog" aria-modal="true" aria-labelledby="dashboard-tour-title">
            <div className="dashboard-tour__backdrop" onClick={closeTour} />
            {spotlightStyle && <div className="dashboard-tour__spotlight" style={spotlightStyle} aria-hidden="true" />}
            <section className="dashboard-tour__card">
                <div className="dashboard-tour__header">
                    <span className="dashboard-tour__eyebrow">{step.eyebrow}</span>
                    <button className="dashboard-tour__close" type="button" onClick={closeTour} aria-label="Close tutorial">
                        ×
                    </button>
                </div>
                <h2 id="dashboard-tour-title">{step.title}</h2>
                <p>{step.description}</p>
                <div className="dashboard-tour__footer">
                    <div className="dashboard-tour__dots" aria-label={`Tutorial step ${stepIndex + 1} of ${STEPS.length}`}>
                        {STEPS.map((item, index) => (
                            <span key={item.target} className={index === stepIndex ? 'is-active' : ''} />
                        ))}
                    </div>
                    <div className="dashboard-tour__actions">
                        <button className="dashboard-tour__skip" type="button" onClick={closeTour}>Skip tutorial</button>
                        {stepIndex > 0 && (
                            <button className="dashboard-tour__back" type="button" onClick={() => setStepIndex((index) => (index ?? 1) - 1)}>
                                Back
                            </button>
                        )}
                        <button
                            className="dashboard-tour__next"
                            type="button"
                            onClick={() => (isLast ? closeTour() : setStepIndex((index) => (index ?? 0) + 1))}
                        >
                            {isLast ? 'Get started' : 'Next'}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    )
}
