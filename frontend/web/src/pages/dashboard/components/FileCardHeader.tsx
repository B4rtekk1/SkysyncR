import { FileIcon } from './FileIcon'
import { isShared } from '../fileCardUtils'
import type { FileKind } from '../fileUtils'
import type { UploadTransferStatus } from '../hooks/useFileUpload'
import type { Item } from '../types'

type FileCardHeaderProps = {
    item: Item
    kind: FileKind
    pending: boolean
    transferStatus: UploadTransferStatus | undefined
}

const PENDING_LABELS: Record<UploadTransferStatus, string> = {
    queued: 'Queued',
    encrypting: 'Encrypting',
    uploading: 'Uploading',
    paused: 'Paused',
    failed: 'Retry needed',
    completed: 'Synced',
}

export function FileCardHeader({ item, kind, pending, transferStatus }: FileCardHeaderProps) {
    const pendingStatus = transferStatus ?? 'encrypting'

    return (
        <div className="file-card__top">
            <FileIcon filename={item.filename} kind={kind} mime={item.mime_type} />
            {pending ? (
                <span className={`file-card__badge file-card__badge--pending file-card__badge--${pendingStatus}`}>
                    {(pendingStatus === 'encrypting' || pendingStatus === 'uploading') && <span className="spinner" />}
                    {PENDING_LABELS[pendingStatus]}
                </span>
            ) : isShared(item) ? (
                <span className="file-card__badge">{item.permissions === 'write' ? 'Can edit' : 'Can view'}</span>
            ) : null}
        </div>
    )
}
