import type { Item } from './types'
import { formatBytes } from './fileUtils'

function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    })
}

function getExtension(filename: string) {
    const ext = filename.split('.').pop()?.trim().toLowerCase()
    return ext ? `.${ext}` : 'presentation'
}

export function SlidesPreview({
    item,
    url,
    onDownload,
}: {
    item: Item
    url: string
    onDownload: (item: Item) => void
}) {
    const extension = getExtension(item.filename)

    return (
        <div className="slides-preview">
            <div className="slides-preview__viewer">
                <object
                    className="slides-preview__object"
                    data={url}
                    type={item.mime_type ?? undefined}
                    aria-label={`Preview ${item.filename}`}
                >
                    <div className="slides-preview__fallback">
                        <strong>Preview unavailable</strong>
                        <p>This browser cannot render {extension} presentations directly.</p>
                        <button className="btn btn--solid" type="button" onClick={() => onDownload(item)}>
                            Download presentation
                        </button>
                    </div>
                </object>
            </div>

            <aside className="slides-preview__side" aria-label="Presentation details">
                <div className="slides-preview__badge" aria-hidden="true">
                    <span>{extension.replace('.', '') || 'ppt'}</span>
                </div>
                <dl className="pdf-preview__info slides-preview__info">
                    <div>
                        <dt>Size</dt>
                        <dd>{formatBytes(item.size_bytes)}</dd>
                    </div>
                    <div>
                        <dt>Type</dt>
                        <dd>{item.mime_type ?? extension}</dd>
                    </div>
                    <div>
                        <dt>Updated</dt>
                        <dd>{formatDate(item.updated_at)}</dd>
                    </div>
                </dl>
            </aside>
        </div>
    )
}
