import type { Item } from './types'
import { formatBytes } from './fileUtils'

function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    })
}

export function PdfPreview({ item, url }: { item: Item; url: string }) {
    return (
        <div className="pdf-preview">
            <object
                className="pdf-preview__frame"
                data={`${url}#toolbar=1&navpanes=0`}
                type="application/pdf"
                aria-label={`PDF preview for ${item.filename}`}
            >
                <div className="pdf-preview__fallback">
                    <p>This browser cannot display the PDF preview.</p>
                    <a href={url} target="_blank" rel="noreferrer">
                        Open PDF
                    </a>
                </div>
            </object>
            <dl className="pdf-preview__info">
                <div>
                    <dt>Size</dt>
                    <dd>{formatBytes(item.size_bytes)}</dd>
                </div>
                <div>
                    <dt>Type</dt>
                    <dd>{item.mime_type ?? 'application/pdf'}</dd>
                </div>
                <div>
                    <dt>Updated</dt>
                    <dd>{formatDate(item.updated_at)}</dd>
                </div>
            </dl>
        </div>
    )
}
