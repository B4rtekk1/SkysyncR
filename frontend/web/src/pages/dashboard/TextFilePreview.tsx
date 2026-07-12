import { useEffect, useState } from 'react'
import { COPY_ICON } from './icons'
import { MarkdownPreview } from './MarkdownPreview'
import type { Item } from './types'
import type { TextPreviewMode } from './useTextFilePreview'

export function TextFilePreviewModeToggle({
    setTextMode,
    textMode,
}: {
    setTextMode: (mode: TextPreviewMode) => void
    textMode: TextPreviewMode
}) {
    return (
        <div className="image-preview__mode-toggle" role="group" aria-label="Markdown preview mode">
            <button
                type="button"
                className={textMode === 'render' ? 'is-active' : ''}
                onClick={() => setTextMode('render')}
                aria-pressed={textMode === 'render'}
            >
                Render
            </button>
            <button
                type="button"
                className={textMode === 'plain' ? 'is-active' : ''}
                onClick={() => setTextMode('plain')}
                aria-pressed={textMode === 'plain'}
            >
                Plain
            </button>
        </div>
    )
}

export function TextFileCopyButton({ item, text }: { item: Item; text: string }) {
    const [copyStatus, setCopyStatus] = useState<'copied' | 'failed' | null>(null)
    const copyTitle = copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy unavailable' : 'Copy'

    useEffect(() => {
        if (copyStatus === null) {
            return
        }

        const timeout = window.setTimeout(() => setCopyStatus(null), 1400)
        return () => window.clearTimeout(timeout)
    }, [copyStatus])

    const copyText = async () => {
        try {
            await navigator.clipboard.writeText(text)
            setCopyStatus('copied')
        } catch {
            setCopyStatus('failed')
        }
    }

    return (
        <button
            className="file-card__action file-card__action--download"
            type="button"
            onClick={() => void copyText()}
            aria-label={`Copy ${item.filename}`}
            title={copyTitle}
        >
            {COPY_ICON}
        </button>
    )
}

export function TextFilePreview({
    canRenderMarkdown,
    text,
    textMode,
}: {
    canRenderMarkdown: boolean
    text: string
    textMode: TextPreviewMode
}) {
    if (canRenderMarkdown && textMode === 'render') {
        return <MarkdownPreview text={text} />
    }

    return (
        <pre className="image-preview__text" tabIndex={0}>
            {text || 'This file is empty.'}
        </pre>
    )
}

export function TextFileEditor({
    error,
    onChange,
    onSave,
    saving,
    text,
}: {
    error: string | null
    onChange: (text: string) => void
    onSave: () => void
    saving: boolean
    text: string
}) {
    return (
        <div className="image-preview__editor-wrap">
            <textarea
                className="image-preview__editor"
                value={text}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault()
                        onSave()
                    }
                }}
                disabled={saving}
                autoFocus
                spellCheck={false}
            />
            {error && <p className="image-preview__editor-error">{error}</p>}
        </div>
    )
}
