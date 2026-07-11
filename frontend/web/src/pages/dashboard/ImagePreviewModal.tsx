import { DOWNLOAD_ICON } from './icons'
import type { ImagePreviewState, Item } from './types'
import { formatBytes } from './fileUtils'
export function ImagePreviewModal({
                               preview,
                               onClose,
                               onDownload,
                           }: {
    preview: ImagePreviewState
    onClose: () => void
    onDownload: (item: Item) => void
}) {
    return (
        <div className="image-preview" role="presentation" onMouseDown={onClose}>
            <div
                className="image-preview__dialog"
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
                    {preview.url && (
                        <img className="image-preview__image" src={preview.url} alt={preview.item.filename} />
                    )}
                </div>
            </div>
        </div>
    )
}


