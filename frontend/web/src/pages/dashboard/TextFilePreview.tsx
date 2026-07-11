import { useState } from 'react'
import { isMarkdownFile } from './fileUtils'
import { MarkdownPreview } from './MarkdownPreview'
import type { Item } from './types'

type TextPreviewMode = 'render' | 'plain'

export function useTextFilePreview(item: Item, text: string | null) {
    const [textModeState, setTextModeState] = useState<{ itemId: string; mode: TextPreviewMode } | null>(null)
    const textMode = textModeState?.itemId === item.id ? textModeState.mode : 'render'
    const canRenderMarkdown = text !== null && isMarkdownFile(item.filename, item.mime_type)
    const setTextMode = (mode: TextPreviewMode) => setTextModeState({ itemId: item.id, mode })

    return { canRenderMarkdown, setTextMode, textMode }
}

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
