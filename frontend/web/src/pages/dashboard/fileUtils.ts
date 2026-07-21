import { useEffect, useState } from 'react'
export const CIPHER_CHARS = '01#$%&*+=ABCDEF'

export function randomCipherChar() {
    return CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)]
}

export function scramble(text: string) {
    return text
        .split('')
        .map((ch) => (ch === '.' ? '.' : randomCipherChar()))
        .join('')
}

export function useDecryptReveal(target: string, delayMs: number) {
    const [display, setDisplay] = useState(() => scramble(target))

    useEffect(() => {
        let interval: ReturnType<typeof setInterval>
        const totalFrames = 12
        let frame = 0

        const start = setTimeout(() => {
            interval = setInterval(() => {
                frame += 1
                const revealCount = Math.ceil((frame / totalFrames) * target.length)
                setDisplay(
                    target
                        .split('')
                        .map((ch, i) => (i < revealCount || ch === '.' ? ch : randomCipherChar()))
                        .join(''),
                )
                if (frame >= totalFrames) {
                    clearInterval(interval)
                    setDisplay(target)
                }
            }, 35)
        }, delayMs)

        return () => {
            clearTimeout(start)
            clearInterval(interval)
        }
    }, [target, delayMs])

    return display
}

export function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function formatRelative(iso: string) {
    const diffMs = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins} min ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`
    return new Date(iso).toLocaleDateString()
}

export type FileKind = 'sheet' | 'document' | 'presentation' | 'pdf' | 'archive' | 'video' | 'audio' | 'text' | 'image' | 'code' | 'file'

const CODE_EXTENSIONS = ['js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'rs', 'py', 'pyw', 'pyi', 'java', 'go', 'xml', 'yaml', 'yml']

export function kindFromFile(filename: string, mime: string | null): FileKind {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const normalizedMime = mime?.toLowerCase() ?? ''

    if (normalizedMime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return 'image'
    if (normalizedMime.startsWith('video/') || ['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext)) return 'video'
    if (normalizedMime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio'
    if (normalizedMime === 'application/pdf' || ext === 'pdf') return 'pdf'
    if (
        normalizedMime.includes('spreadsheet') ||
        normalizedMime.includes('excel') ||
        normalizedMime === 'text/csv' ||
        ['xlsx', 'xls', 'csv', 'ods'].includes(ext)
    ) {
        return 'sheet'
    }
    if (normalizedMime.includes('presentation') || ['ppt', 'pptx', 'odp'].includes(ext)) return 'presentation'
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return 'archive'
    if (
        normalizedMime.startsWith('text/') ||
        ['txt', 'md', 'rtf'].includes(ext)
    ) {
        return CODE_EXTENSIONS.includes(ext) ? 'code' : 'text'
    }
    if (CODE_EXTENSIONS.includes(ext)) return 'code'
    if (['doc', 'docx', 'odt'].includes(ext) || normalizedMime.includes('wordprocessingml')) return 'document'
    return 'file'
}

export function isMarkdownFile(filename: string, mime: string | null) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const normalizedMime = mime?.toLowerCase() ?? ''
    return normalizedMime === 'text/markdown' || normalizedMime === 'text/x-markdown' || ['md', 'markdown', 'mdown'].includes(ext)
}

export function isPythonFile(filename: string, mime: string | null) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const normalizedMime = mime?.toLowerCase() ?? ''
    return ['py', 'pyw', 'pyi'].includes(ext) || normalizedMime === 'text/x-python' || normalizedMime === 'application/x-python-code'
}

export function isTypeScriptFile(filename: string, mime: string | null) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const normalizedMime = mime?.toLowerCase() ?? ''
    return ['ts', 'tsx'].includes(ext) || normalizedMime === 'text/typescript' || normalizedMime === 'application/typescript'
}

export function isJavaScriptFile(filename: string, mime: string | null) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const normalizedMime = mime?.toLowerCase() ?? ''
    return (
        ['js', 'jsx', 'mjs', 'cjs'].includes(ext) ||
        normalizedMime === 'text/javascript' ||
        normalizedMime === 'application/javascript' ||
        normalizedMime === 'application/x-javascript'
    )
}

export const KIND_ACCENT: Record<FileKind, string> = {
    sheet: 'var(--signal)',
    document: 'var(--mist)',
    presentation: 'var(--amber)',
    pdf: '#ff6b6b',
    archive: 'var(--amber)',
    video: 'var(--amber)',
    audio: 'var(--signal)',
    text: 'var(--signal)',
    image: 'var(--signal)',
    code: 'var(--mist)',
    file: 'var(--mist)',
}

export const KIND_LABELS: Record<FileKind, string> = {
    sheet: 'Sheets',
    document: 'Docs',
    presentation: 'Slides',
    pdf: 'PDFs',
    archive: 'Archives',
    video: 'Videos',
    audio: 'Audio',
    text: 'Text',
    image: 'Images',
    code: 'Code',
    file: 'Files',
}



