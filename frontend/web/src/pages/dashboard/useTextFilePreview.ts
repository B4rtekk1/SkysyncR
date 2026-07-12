import { useState } from 'react'
import { isMarkdownFile } from './fileUtils'
import type { Item } from './types'

export type TextPreviewMode = 'render' | 'plain'

export function useTextFilePreview(item: Item, text: string | null) {
    const [textModeState, setTextModeState] = useState<{ itemId: string; mode: TextPreviewMode } | null>(null)
    const textMode = textModeState?.itemId === item.id ? textModeState.mode : 'render'
    const canRenderMarkdown = text !== null && isMarkdownFile(item.filename, item.mime_type)
    const setTextMode = (mode: TextPreviewMode) => setTextModeState({ itemId: item.id, mode })

    return { canRenderMarkdown, setTextMode, textMode }
}
