import { useState } from 'react'
import { CANCEL_ICON, CHECK_ICON, DOWNLOAD_ICON, RENAME_ICON } from './icons'
import type { FilePreviewState, Item } from './types'
import { formatBytes } from './fileUtils'
import { TextFileCopyButton, TextFileEditor, TextFilePreview, TextFilePreviewModeToggle } from './TextFilePreview'
import { useTextFilePreview } from './useTextFilePreview'
import { VideoPreviewPlayer } from './VideoPreviewPlayer'
import { PdfPreview } from './PdfPreview'

export function ImagePreviewModal({
                               preview,
                               onClose,
                               onDownload,
                               onSaveText,
                           }: {
    preview: FilePreviewState
    onClose: () => void
    onDownload: (item: Item) => void
    onSaveText: (item: Item, text: string) => Promise<void>
}) {
    const { canRenderMarkdown, setTextMode, textMode } = useTextFilePreview(preview.item, preview.text)
    const [isEditingText, setIsEditingText] = useState(Boolean(preview.startEditing))
    const [editDraft, setEditDraft] = useState(preview.text ?? '')
    const [editSaving, setEditSaving] = useState(false)
    const [editError, setEditError] = useState<string | null>(null)
    const canEditText = preview.text !== null && !('permissions' in preview.item)
    const hasTextChanges = editDraft !== (preview.text ?? '')

    const cancelEdit = () => {
        setEditDraft(preview.text ?? '')
        setEditError(null)
        setIsEditingText(false)
    }

    const saveEdit = async () => {
        if (!canEditText || editSaving || !hasTextChanges) {
            setIsEditingText(false)
            return
        }

        setEditSaving(true)
        setEditError(null)
        try {
            await onSaveText(preview.item, editDraft)
            setIsEditingText(false)
        } catch (e) {
            setEditError(e instanceof Error ? e.message : 'Could not save that file.')
        } finally {
            setEditSaving(false)
        }
    }

    return (
        <div className="image-preview" role="presentation" onMouseDown={onClose}>
            <div
                className={`image-preview__dialog ${isEditingText ? 'image-preview__dialog--editing' : ''}`}
                role="dialog"
                aria-modal="true"
                aria-label={`Preview ${preview.item.filename}`}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="image-preview__head">
                    <div className="image-preview__title">
                        <strong title={preview.item.filename}>{preview.item.filename}</strong>
                        <span>{formatBytes(preview.item.size_bytes)}</span>
                    </div>
                    <div className="image-preview__actions">
                        {isEditingText ? (
                            <>
                                <button
                                    className="file-card__action file-card__action--confirm"
                                    type="button"
                                    onClick={() => void saveEdit()}
                                    disabled={editSaving}
                                    aria-label={`Save ${preview.item.filename}`}
                                    title="Save"
                                >
                                    {CHECK_ICON}
                                </button>
                                <button
                                    className="file-card__action file-card__action--cancel"
                                    type="button"
                                    onClick={cancelEdit}
                                    disabled={editSaving}
                                    aria-label={`Cancel editing ${preview.item.filename}`}
                                    title="Cancel"
                                >
                                    {CANCEL_ICON}
                                </button>
                            </>
                        ) : canRenderMarkdown ? (
                            <TextFilePreviewModeToggle setTextMode={setTextMode} textMode={textMode} />
                        ) : null}
                        {canEditText && !isEditingText && (
                            <button
                                className="file-card__action file-card__action--rename"
                                type="button"
                                onClick={() => {
                                    setEditDraft(preview.text ?? '')
                                    setEditError(null)
                                    setIsEditingText(true)
                                }}
                                aria-label={`Edit ${preview.item.filename}`}
                                title="Edit"
                            >
                                {RENAME_ICON}
                            </button>
                        )}
                        {preview.text !== null && !isEditingText && (
                            <TextFileCopyButton item={preview.item} text={preview.text} />
                        )}
                        <button
                            className="file-card__action file-card__action--download"
                            type="button"
                            onClick={() => onDownload(preview.item)}
                            aria-label={`Download ${preview.item.filename}`}
                            title="Download"
                        >
                            {DOWNLOAD_ICON}
                        </button>
                        <button
                            className="image-preview__close"
                            type="button"
                            onClick={onClose}
                            aria-label="Close preview"
                            title="Close"
                        >
                            x
                        </button>
                    </div>
                </div>
                <div className="image-preview__stage">
                    {preview.loading && (
                        <div className="image-preview__loading">
                            <span className="spinner" />
                            Loading preview...
                        </div>
                    )}
                    {preview.url && preview.kind === 'image' && (
                        <img className="image-preview__image" src={preview.url} alt={preview.item.filename} />
                    )}
                    {preview.url && preview.kind === 'video' && (
                        <VideoPreviewPlayer item={preview.item} url={preview.url} />
                    )}
                    {preview.url && preview.kind === 'pdf' && (
                        <PdfPreview item={preview.item} url={preview.url} />
                    )}
                    {preview.text !== null && (
                        isEditingText ? (
                            <TextFileEditor
                                canRenderMarkdown={canRenderMarkdown}
                                error={editError}
                                saving={editSaving}
                                text={editDraft}
                                onChange={setEditDraft}
                                onSave={() => void saveEdit()}
                            />
                        ) : (
                            <TextFilePreview
                                canRenderMarkdown={canRenderMarkdown}
                                text={preview.text}
                                textMode={textMode}
                            />
                        )
                    )}
                </div>
            </div>
        </div>
    )
}


