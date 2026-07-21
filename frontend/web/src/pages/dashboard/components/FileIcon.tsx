import type { FileKind } from '../fileUtils'
import { isJavaScriptFile, isPythonFile, isTypeScriptFile, KIND_ACCENT } from '../fileUtils'
const DOCUMENT_ICON_PATH = 'M6 2.5h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z'
const DOCUMENT_FOLD_PATH = 'M14 2.5V7a1 1 0 0 0 1 1h4.5'

export function FileIcon({ filename, kind, mime }: { filename: string; kind: FileKind; mime: string | null }) {
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
        if (isPythonFile(filename, mime)) {
            return (
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                        d="M12.6 2.8h3.7a4 4 0 0 1 4 4v4.1a3.1 3.1 0 0 1-3.1 3.1H9.5a2 2 0 0 0-2 2v1.2H5.7a4 4 0 0 1-4-4V9.1a4 4 0 0 1 4-4h6.9V2.8Z"
                        fill="#3776ab"
                        transform="matrix(.9 0 0 1 1.2 0)"
                    />
                    <path
                        d="M11.4 21.2H7.7a4 4 0 0 1-4-4v-4.1A3.1 3.1 0 0 1 6.8 10h7.7a2 2 0 0 0 2-2V6.8h1.8a4 4 0 0 1 4 4v4.1a4 4 0 0 1-4 4h-6.9v2.3Z"
                        fill="#ffd43b"
                        transform="matrix(.9 0 0 1 1.2 0)"
                    />
                    <circle cx="8.13" cy="8.4" r="1.05" fill="#f8fafc" />
                    <circle cx="15.87" cy="15.6" r="1.05" fill="#1f2937" />
                </svg>
            )
        }
        if (isTypeScriptFile(filename, mime)) {
            return (
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2.4" fill="#3178c6" />
                    <path
                        d="M7 10.1h6.2v1.65h-2.1V17H9.1v-5.25H7v-1.65ZM14.1 16.3c.55.48 1.32.72 2.2.72 1.5 0 2.55-.75 2.55-2.08 0-1.16-.66-1.67-2.08-2.08-.75-.22-1.02-.38-1.02-.72 0-.33.28-.54.78-.54.58 0 1.04.18 1.52.58l.7-1.28a3.2 3.2 0 0 0-2.18-.76c-1.48 0-2.48.82-2.48 2.04 0 1.28.78 1.74 2.16 2.12.7.2.94.38.94.7 0 .36-.31.56-.85.56-.68 0-1.24-.22-1.78-.68l-.46 1.42Z"
                        fill="#ffffff"
                    />
                </svg>
            )
        }
        if (isJavaScriptFile(filename, mime)) {
            return (
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2.4" fill="#f7df1e" />
                    <path
                        d="M8.1 16.35c.3.48.68.86 1.45.86.72 0 1.18-.36 1.18-1.75v-5.38h1.82v5.42c0 2.02-1.18 2.94-2.9 2.94-1.55 0-2.45-.8-2.9-1.76l1.35-.33ZM13.55 16.14c.5.82 1.14 1.18 2.28 1.18.95 0 1.56-.48 1.56-1.14 0-.8-.63-1.08-1.7-1.54l-.58-.25c-1.7-.72-2.82-1.62-2.82-3.52 0-1.76 1.34-3.1 3.43-3.1 1.49 0 2.56.52 3.33 1.88l-1.82 1.17c-.4-.72-.83-1-1.51-1-.69 0-1.12.44-1.12 1 0 .7.44.98 1.45 1.42l.58.25c2 .86 3.12 1.74 3.12 3.72 0 2.13-1.67 3.3-3.92 3.3-2.2 0-3.62-1.05-4.32-2.43l2.04-.94Z"
                        fill="#1f2937"
                        transform="matrix(.66 0 0 .66 3.55 3.9)"
                    />
                </svg>
            )
        }

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


