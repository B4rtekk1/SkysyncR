import type { ReactNode } from 'react'

export function EmptyPane({ title, body, actions }: { title: string; body: string; actions?: ReactNode }) {
    return (
        <div className="empty-pane">
            <div className="empty-pane__icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path
                        d="M4.75 7.5A2.75 2.75 0 0 1 7.5 4.75h9A2.75 2.75 0 0 1 19.25 7.5v9a2.75 2.75 0 0 1-2.75 2.75h-9a2.75 2.75 0 0 1-2.75-2.75v-9Z"
                        stroke="currentColor"
                        strokeWidth="1.7"
                    />
                    <path
                        d="M8 12h8M12 8v8"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                    />
                </svg>
            </div>
            <p className="empty-pane__title">{title}</p>
            <p className="empty-pane__body">{body}</p>
            {actions && <div className="empty-pane__actions">{actions}</div>}
        </div>
    )
}


