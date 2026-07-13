import type { CSSProperties } from 'react'
import type { ApiFolder } from '../../api/files'
import { formatRelative } from './fileUtils'

export function FolderCard({
    folder,
    index,
    onOpen,
}: {
    folder: ApiFolder
    index: number
    onOpen: (folder: ApiFolder) => void
}) {
    const fileCountLabel = folder.file_count === 1 ? '1 file' : `${folder.file_count} files`

    return (
        <article
            className="file-card folder-card file-card--can-preview"
            style={{ '--file-index': index } as CSSProperties}
            role="button"
            tabIndex={0}
            aria-label={`Open folder ${folder.name}`}
            onClick={() => onOpen(folder)}
            onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onOpen(folder)
            }}
        >
            <div className="file-card__top">
                <span className="file-card__badge folder-card__badge">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                            d="M3.5 7.5a2 2 0 0 1 2-2h4.4l2 2H18.5a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinejoin="round"
                        />
                    </svg>
                    Folder
                </span>
            </div>
            <div className="file-card__name-slot">
                <p className="file-card__name" title={folder.name}>
                    {folder.name}
                </p>
            </div>
            <p className="file-card__meta">
                {fileCountLabel} · Updated {formatRelative(folder.updated_at)}
            </p>
        </article>
    )
}
