import { useState } from 'react'
import { isMarkdownFile, isPythonFile, isTypeScriptFile } from '../fileUtils'
import type { Item } from '../types'

export type TextPreviewMode = 'render' | 'plain'
export type CodeHighlightLanguage = 'python' | 'typescript'

export function useTextFilePreview(item: Item, text: string | null) {
    const [textModeState, setTextModeState] = useState<{ itemId: string; mode: TextPreviewMode } | null>(null)
    const textMode = textModeState?.itemId === item.id ? textModeState.mode : 'render'
    const canRenderMarkdown = text !== null && isMarkdownFile(item.filename, item.mime_type)
    const canHighlightPython = text !== null && isPythonFile(item.filename, item.mime_type)
    const canHighlightTypeScript = text !== null && isTypeScriptFile(item.filename, item.mime_type)
    const highlightLanguage: CodeHighlightLanguage | null = canHighlightPython
        ? 'python'
        : canHighlightTypeScript
          ? 'typescript'
          : null
    const setTextMode = (mode: TextPreviewMode) => setTextModeState({ itemId: item.id, mode })

    return { canHighlightPython, canRenderMarkdown, highlightLanguage, setTextMode, textMode }
}
