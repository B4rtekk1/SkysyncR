import type { FileKind } from './fileUtils'
import { KIND_ACCENT } from './fileUtils'
const DOCUMENT_ICON_PATH = 'M6 2.5h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z'
const DOCUMENT_FOLD_PATH = 'M14 2.5V7a1 1 0 0 0 1 1h4.5'

export function FileIcon({ kind }: { kind: FileKind }) {
    const accent = KIND_ACCENT[kind]
    const common = {
        stroke: accent,
        strokeWidth: '1.4',
        fill: 'none',
    }

    if (kind === 'image') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3.5" y="5" width="17" height="14" rx="2" {...common} />
                <circle cx="8.5" cy="9.5" r="1.4" {...common} />
                <path d="M5.5 17l4.2-4.4 3 3 2.1-2.2 3.7 3.6" {...common} />
            </svg>
        )
    }
    if (kind === 'video') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="6" width="12" height="12" rx="2" {...common} />
                <path d="M16 10l4-2.3v8.6L16 14" {...common} />
            </svg>
        )
    }
    if (kind === 'audio') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 17V7l8-2v10" {...common} />
                <circle cx="7" cy="17" r="2" {...common} />
                <circle cx="15" cy="15" r="2" {...common} />
            </svg>
        )
    }
    if (kind === 'archive') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 3h12v18H6z" {...common} />
                <path d="M10 3v4h2V3M12 7v4h2V7M10 11v4h2v-4M12 15v3" {...common} />
            </svg>
        )
    }
    if (kind === 'sheet') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d={DOCUMENT_ICON_PATH} {...common} />
                <path d={DOCUMENT_FOLD_PATH} {...common} />
                <path d="M8 11h8M8 14h8M8 17h8M11 9v10M14.5 9v10" {...common} strokeLinecap="round" />
            </svg>
        )
    }
    if (kind === 'pdf') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d={DOCUMENT_ICON_PATH} {...common} />
                <path d="M8 16c1.8-3.3 3.2-6.5 3.1-8.2-.1-1.4-1.8-1.2-1.6.2.3 2.5 2.8 6.8 5.7 7.6 1.3.4 1.8-.9.6-1.3-1.8-.6-5.2.4-7.8 1.7Z" {...common} />
            </svg>
        )
    }
    if (kind === 'text') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d={DOCUMENT_ICON_PATH} {...common} />
                <path d={DOCUMENT_FOLD_PATH} {...common} />
                <path d="M8 11h4.2M14.2 11H16M8 14h8M8 17h3.6M13.5 17H16" {...common} strokeLinecap="round" />
            </svg>
        )
    }
    if (kind === 'code') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8.5 8L5 12l3.5 4M15.5 8L19 12l-3.5 4M13 6.5l-2 11" {...common} />
            </svg>
        )
    }
    if (kind === 'presentation') {
        return (
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4h16v11H4zM12 15v5M8.5 20h7" {...common} />
                <path d="M8 11l2.5-2.5 2 2L16 7" {...common} />
            </svg>
        )
    }

    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d={DOCUMENT_ICON_PATH}
                stroke={accent}
                strokeWidth="1.4"
                fill="none"
            />
            <path d={DOCUMENT_FOLD_PATH} stroke={accent} strokeWidth="1.4" fill="none" />
        </svg>
    )
}


