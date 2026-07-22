import { useEffect, useState } from 'react'
import { CANCEL_ICON, CHECK_ICON, CLOSE_ICON } from '../icons'
import { TextFileEditor } from '../previews/TextFilePreview'
import type { Item } from '../types'

type FileNoteModalProps = {
    item: Item
    saving: boolean
    onClose: () => void
    onSave: (item: Item, note: string) => Promise<void>
}

export function FileNoteModal({ item, saving, onClose, onSave }: FileNoteModalProps) {
    const [note, setNote] = useState(item.note ?? '')
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        function closeOnEscape(e: globalThis.KeyboardEvent) {
            if (e.key === 'Escape' && !saving) onClose()
        }

        window.addEventListener('keydown', closeOnEscape)
        return () => window.removeEventListener('keydown', closeOnEscape)
    }, [onClose, saving])

    async function saveNote() {
        if (saving) return
        setError(null)

        try {
            await onSave(item, note)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the note.')
        }
    }

    return (
        <div className="image-preview" role="presentation" onMouseDown={() => !saving && onClose()}>
            <div
                className="image-preview__dialog image-preview__dialog--editing"
                role="dialog"
                aria-modal="true"
                aria-label={`Edit note for ${item.filename}`}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="image-preview__head">
                    <div className="image-preview__title">
                        <strong title={item.filename}>{item.filename}</strong>
                        <span>Markdown note</span>
                    </div>
                    <div className="image-preview__actions">
                        <button
                            className="file-card__action file-card__action--confirm"
                            type="button"
                            onClick={() => void saveNote()}
                            disabled={saving}
                            aria-label={`Save note for ${item.filename}`}
                            title="Save"
                        >
                            {CHECK_ICON}
                        </button>
                        <button
                            className="file-card__action file-card__action--cancel"
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            aria-label={`Cancel note editing for ${item.filename}`}
                            title="Cancel"
                        >
                            {CANCEL_ICON}
                        </button>
                        <button
                            className="image-preview__close"
                            type="button"
                            onClick={onClose}
                            disabled={saving}
                            aria-label="Close preview"
                            title="Close"
                        >
                            {CLOSE_ICON}
                        </button>
                    </div>
                </div>
                <div className="image-preview__stage">
                    <div className="note-editor-shell">
                        <div className="note-editor-shell__labels" aria-hidden="true">
                            <span>Plain Markdown</span>
                            <span>Rendered Preview</span>
                        </div>
                <TextFileEditor
                    canHighlightPython={false}
                    canRenderMarkdown
                    highlightLanguage={null}
                    error={error}
                            saving={saving}
                            text={note}
                            onChange={setNote}
                            onSave={() => void saveNote()}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}
