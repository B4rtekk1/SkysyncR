import { useState } from 'react'
import { isMarkdownFile, isPythonFile } from './fileUtils'
import type { Item } from './types'

export type TextPreviewMode = 'render' | 'plain'

export function useTextFilePreview(item: Item, text: string | null) {
    const [textModeState, setTextModeState] = useState<{ itemId: string; mode: TextPreviewMode } | null>(null)
    const textMode = textModeState?.itemId === item.id ? textModeState.mode : 'render'
    const canRenderMarkdown = text !== null && isMarkdownFile(item.filename, item.mime_type)
    const canHighlightPython = text !== null && isPythonFile(item.filename, item.mime_type)
    const setTextMode = (mode: TextPreviewMode) => setTextModeState({ itemId: item.id, mode })

    return { canHighlightPython, canRenderMarkdown, setTextMode, textMode }
}
