import type { GroupInviteRole } from '../types'

export const PLUS_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
)

export const ARROW_LEFT_ICON = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m15 6-6 6 6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

export const ARROW_RIGHT_ICON = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

export const CLOSE_ICON = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
)

export const CHECK_ICON = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 12.5 9.3 17 19 7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

export const MEMBERS_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            d="M16 20v-1.6c0-1.7-1.4-3.1-3.1-3.1H7.1A3.1 3.1 0 0 0 4 18.4V20M10 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 20v-1.4c0-1.4-.9-2.6-2.2-3M15.3 4.3a3.6 3.6 0 0 1 0 7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
)

export const CREATED_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            d="M7 3v3M17 3v3M4.5 9.5h15M6.5 5h11A2.5 2.5 0 0 1 20 7.5v10A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-10A2.5 2.5 0 0 1 6.5 5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
)

export const ROLE_LABELS: Record<GroupInviteRole, string> = {
    viewer: 'Viewer',
    editor: 'Editor',
    admin: 'Admin',
}
