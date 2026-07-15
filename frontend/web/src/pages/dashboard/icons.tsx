import React from 'react'
import type { ViewKey } from './types'
export const NAV_ICONS: Record<ViewKey, React.ReactElement> = {
    all: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 6.5h6l2 2.5h8v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.4" />
        </svg>
    ),
    shared: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="7" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="17" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="17" cy="18" r="2.4" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9.1 11l5.8-3.6M9.1 13l5.8 3.6" stroke="currentColor" strokeWidth="1.4" />
        </svg>
    ),
    groups: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="8" cy="8.5" r="2.8" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="16.5" cy="9.5" r="2.2" stroke="currentColor" strokeWidth="1.4" />
            <path
                d="M3.8 18.5c.6-2.9 2.4-4.6 4.2-4.6s3.6 1.7 4.2 4.6M13.5 17.8c.5-2 1.7-3.1 3-3.1s2.5 1.1 3 3.1"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
            />
        </svg>
    ),
    calendar: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4.5" y="5.5" width="15" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 3.8v3.4M16 3.8v3.4M4.8 9.5h14.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M8 13h2M12 13h2M16 13h.1M8 16h2M12 16h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    ),
    trash: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 7h14M9.5 7V5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M7 7l1 12.2a1 1 0 0 0 1 .8h6a1 1 0 0 0 1-.8L17 7" stroke="currentColor" strokeWidth="1.4" />
        </svg>
    ),
    favourites: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M12 3.5l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.4l-5.1 2.8.98-5.68-4.13-4.02 5.7-.83L12 3.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
            />
        </svg>
    ),
}

export const STAR_ICON_FILLED = (
    <svg className="star-icon star-icon--filled" width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path
            className="star-icon__shape"
            d="M12 3.5l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.4l-5.1 2.8.98-5.68-4.13-4.02 5.7-.83L12 3.5Z"
        />
        <path
            className="star-icon__burst"
            d="M12 1.8v2M20.2 5.1l-1.5 1.35M22.1 13.2h-2M17.6 21.2l-1-1.7M6.4 21.2l1-1.7M1.9 13.2h2M3.8 5.1l1.5 1.35"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
        />
    </svg>
)

export const STAR_ICON_OUTLINE = (
    <svg className="star-icon star-icon--outline" width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            className="star-icon__shape"
            d="M12 3.5l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.4l-5.1 2.8.98-5.68-4.13-4.02 5.7-.83L12 3.5Z"
            stroke="currentColor"
            strokeWidth="1.4"
        />
        <path
            className="star-icon__burst"
            d="M12 1.8v2M20.2 5.1l-1.5 1.35M22.1 13.2h-2M17.6 21.2l-1-1.7M6.4 21.2l1-1.7M1.9 13.2h2M3.8 5.1l1.5 1.35"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
        />
    </svg>
)

export const TRASH_OPEN_ICON = (
    <svg className="trash-open-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            className="trash-open-icon__lid"
            d="M8.5 6.5h7M10 4.5h4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
        />
        <path
            d="M6.5 8h11l-.8 11.2a1.5 1.5 0 0 1-1.5 1.4H8.8a1.5 1.5 0 0 1-1.5-1.4L6.5 8Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
        />
        <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
)

export const DOWNLOAD_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            className="download-icon__arrow"
            d="M12 4v10M8.25 10.25 12 14l3.75-3.75"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <path
            className="download-icon__tray"
            d="M5 18.5h14"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
        />
    </svg>
)

export const COPY_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="8" y="8" width="10" height="12" rx="1.8" stroke="currentColor" strokeWidth="1.6" />
        <path
            d="M6 16H5.8A1.8 1.8 0 0 1 4 14.2V5.8A1.8 1.8 0 0 1 5.8 4h7.4A1.8 1.8 0 0 1 15 5.8V6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
        />
    </svg>
)

export const SHARE_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="7" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="17" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="17" cy="18" r="2.4" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9.1 11l5.8-3.6M9.1 13l5.8 3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
)

export const RENAME_ICON = (
    <svg className="rename-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            className="rename-icon__line"
            d="M5 18.5h14"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
        />
        <path
            className="rename-icon__pencil"
            d="m13.8 5.2 5 5M4.8 17.2l1.1-4.2 8.7-8.7a2 2 0 0 1 2.8 0l1.1 1.1a2 2 0 0 1 0 2.8L9.8 16.9l-4.2 1.1a.7.7 0 0 1-.8-.8Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
        />
        <path
            className="rename-icon__spark"
            d="M6.2 11.8 4.8 10.4M8.4 9.6 7.7 7.8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
        />
    </svg>
)

export const INFO_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="8" r="1.1" fill="currentColor" />
    </svg>
)

export const NOTE_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            d="M6.5 4.5h8.2L18 7.8v11.7H6.5v-15Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
        />
        <path d="M14.5 4.8V8h3.2M9 12h6M9 15.5h4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
)

export const CHECK_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 12.5 9.3 17 19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
)

export const CANCEL_ICON = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
)

export const SETTINGS_ICON = (
    <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
)

export const DRAG_HANDLE_ICON = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="8" cy="6" r="1.6" />
        <circle cx="16" cy="6" r="1.6" />
        <circle cx="8" cy="12" r="1.6" />
        <circle cx="16" cy="12" r="1.6" />
        <circle cx="8" cy="18" r="1.6" />
        <circle cx="16" cy="18" r="1.6" />
    </svg>
)

export const SIDEBAR_HIDE_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.75" y="4.5" width="16.5" height="15" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8.5 4.5v15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path
            d="M15.25 8.75 12 12l3.25 3.25"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
)

export const SIDEBAR_SHOW_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.75" y="4.5" width="16.5" height="15" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8.5 4.5v15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path
            d="m12.75 8.75 3.25 3.25-3.25 3.25"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
)

export const GRID_VIEW_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="4" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="14" y="14" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
)

export const LIST_VIEW_ICON = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="4.5" cy="6" r="1.2" fill="currentColor" />
        <circle cx="4.5" cy="12" r="1.2" fill="currentColor" />
        <circle cx="4.5" cy="18" r="1.2" fill="currentColor" />
    </svg>
)


