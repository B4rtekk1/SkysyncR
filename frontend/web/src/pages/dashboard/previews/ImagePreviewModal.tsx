import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import '../../../css/dashboard/preview-image.css'
import { CANCEL_ICON, CHECK_ICON, CLOSE_ICON, DOWNLOAD_ICON, RENAME_ICON } from '../icons'
import type { FilePreviewState, Item } from '../types'
import { formatBytes } from '../fileUtils'
import { TextFileCopyButton, TextFileEditor, TextFilePreview, TextFilePreviewModeToggle } from './TextFilePreview'
import { useTextFilePreview } from './useTextFilePreview'

const PdfPreview = lazy(() => import('./PdfPreview').then((module) => ({ default: module.PdfPreview })))
const SlidesPreview = lazy(() => import('./SlidesPreview').then((module) => ({ default: module.SlidesPreview })))
const VideoPreviewPlayer = lazy(() =>
    import('./VideoPreviewPlayer').then((module) => ({ default: module.VideoPreviewPlayer })),
)
const AUTOSAVE_DELAY_MS = 1200
const loadedPreviewImageUrls = new Set<string>()

type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

function PreviewFallback({ label }: { label: string }) {
    return (
        <div className="image-preview__loading">
            <span className="spinner" />
            {label}
        </div>
    )
}

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
    const { canHighlightPython, canRenderMarkdown, highlightLanguage, setTextMode, textMode } = useTextFilePreview(preview.item, preview.text)
    const [isEditingText, setIsEditingText] = useState(Boolean(preview.startEditing))
    const [editDraft, setEditDraft] = useState(preview.text ?? '')
    const [manualSaving, setManualSaving] = useState(false)
    const [loadedImageUrl, setLoadedImageUrl] = useState<string | null>(null)
    const [editError, setEditError] = useState<string | null>(null)
    const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle')
    const saveInFlightRef = useRef(false)
    const autosaveTimerRef = useRef<number | null>(null)
    const canEditText = preview.text !== null && !('permissions' in preview.item)
    const hasTextChanges = editDraft !== (preview.text ?? '')
    const isImageLoaded = preview.url ? loadedPreviewImageUrls.has(preview.url) || loadedImageUrl === preview.url : false

    const markImageLoaded = useCallback((url: string | null) => {
        if (!url) return

        loadedPreviewImageUrls.add(url)
        setLoadedImageUrl(url)
    }, [])

    const captureLoadedImage = useCallback((node: HTMLImageElement | null) => {
        if (!node || !node.complete || node.naturalWidth <= 0) return

        markImageLoaded(node.currentSrc || node.src)
    }, [markImageLoaded])

    const cancelEdit = () => {
        if (autosaveTimerRef.current) {
            window.clearTimeout(autosaveTimerRef.current)
            autosaveTimerRef.current = null
        }
        setEditDraft(preview.text ?? '')
        setEditError(null)
        setAutosaveStatus('idle')
        setIsEditingText(false)
    }

    const saveEdit = useCallback(async ({ closeAfterSave = true }: { closeAfterSave?: boolean } = {}) => {
        if (!canEditText || saveInFlightRef.current || !hasTextChanges) {
            if (closeAfterSave) {
                setIsEditingText(false)
            }
            return
        }

        if (autosaveTimerRef.current) {
            window.clearTimeout(autosaveTimerRef.current)
            autosaveTimerRef.current = null
        }

        const textToSave = editDraft
        saveInFlightRef.current = true
        if (closeAfterSave) {
            setManualSaving(true)
        }
        setEditError(null)
        setAutosaveStatus('saving')
        try {
            await onSaveText(preview.item, textToSave)
            setAutosaveStatus('saved')
            if (closeAfterSave) {
                setIsEditingText(false)
            }
        } catch (e) {
            setEditError(e instanceof Error ? e.message : 'Could not save that file.')
            setAutosaveStatus('error')
        } finally {
            saveInFlightRef.current = false
            setManualSaving(false)
        }
    }, [canEditText, editDraft, hasTextChanges, onSaveText, preview.item])

    useEffect(() => {
        if (
            !isEditingText ||
            !canEditText ||
            !hasTextChanges ||
            manualSaving ||
            autosaveStatus === 'saving' ||
            saveInFlightRef.current
        ) {
            return
        }

        if (autosaveTimerRef.current) {
            window.clearTimeout(autosaveTimerRef.current)
        }

        autosaveTimerRef.current = window.setTimeout(() => {
            void saveEdit({ closeAfterSave: false })
        }, AUTOSAVE_DELAY_MS)

        return () => {
            if (autosaveTimerRef.current) {
                window.clearTimeout(autosaveTimerRef.current)
                autosaveTimerRef.current = null
            }
        }
    }, [autosaveStatus, canEditText, editDraft, hasTextChanges, isEditingText, manualSaving, saveEdit])

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
                                    disabled={manualSaving}
                                    aria-label={`Save ${preview.item.filename}`}
                                    title="Save"
                                >
                                    {CHECK_ICON}
                                </button>
                                <button
                                    className="file-card__action file-card__action--cancel"
                                    type="button"
                                    onClick={cancelEdit}
                                    disabled={manualSaving}
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
                            {CLOSE_ICON}
                        </button>
                    </div>
                </div>
                <div className="image-preview__stage">
                    {preview.loading && !(preview.kind === 'image' && preview.url) && (
                        <div className="image-preview__loading">
                            <span className="spinner" />
                            Loading preview...
                        </div>
                    )}
                    {preview.url && preview.kind === 'image' && (
                        <div
                            className={`image-preview__image-shell ${
                                isImageLoaded ? 'is-loaded' : ''
                            }`}
                            style={{ backgroundImage: `url("${preview.url}")` }}
                        >
                            <img
                                ref={captureLoadedImage}
                                className="image-preview__image"
                                src={preview.url}
                                alt={preview.item.filename}
                                onLoad={() => markImageLoaded(preview.url)}
                                onError={() => markImageLoaded(preview.url)}
                            />
                        </div>
                    )}
                    {preview.url && preview.kind === 'video' && (
                        <Suspense fallback={<PreviewFallback label="Loading video preview..." />}>
                            <VideoPreviewPlayer item={preview.item} url={preview.url} />
                        </Suspense>
                    )}
                    {preview.url && preview.kind === 'pdf' && (
                        <Suspense fallback={<PreviewFallback label="Loading PDF preview..." />}>
                            <PdfPreview item={preview.item} url={preview.url} />
                        </Suspense>
                    )}
                    {preview.url && preview.kind === 'presentation' && (
                        <Suspense fallback={<PreviewFallback label="Loading presentation preview..." />}>
                            <SlidesPreview item={preview.item} url={preview.url} onDownload={onDownload} />
                        </Suspense>
                    )}
                    {preview.text !== null && (
                        isEditingText ? (
                            <TextFileEditor
                                canHighlightPython={canHighlightPython}
                                canRenderMarkdown={canRenderMarkdown}
                                highlightLanguage={highlightLanguage}
                                error={editError}
                                autosaveStatus={autosaveStatus}
                                saving={manualSaving}
                                text={editDraft}
                                onChange={(value) => {
                                    setEditDraft(value)
                                    setAutosaveStatus('pending')
                                }}
                                onSave={() => void saveEdit()}
                            />
                        ) : (
                            <TextFilePreview
                                canHighlightPython={canHighlightPython}
                                canRenderMarkdown={canRenderMarkdown}
                                highlightLanguage={highlightLanguage}
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
