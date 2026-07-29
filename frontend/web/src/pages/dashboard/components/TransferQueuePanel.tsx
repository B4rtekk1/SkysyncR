import type { UploadTransfer } from '../hooks/useFileUpload'
import type { DownloadTransfer } from '../hooks/useDownloadTransfers'
import { formatBytes } from '../fileUtils'

export type TransferHistoryEntry = UploadTransfer | DownloadTransfer

type TransferQueuePanelProps = {
    transfers: TransferHistoryEntry[]
    onPause: (id: string) => void
    onResume: (id: string) => void
    onRetry: (id: string) => void
    onRemove: (id: string) => void
    onPauseAll: () => void
    onResumeAll: () => void
}

const STATUS_LABELS: Record<TransferHistoryEntry['status'], string> = {
    queued: 'Queued',
    encrypting: 'Encrypting',
    uploading: 'Uploading',
    downloading: 'Downloading',
    verifying: 'Verifying',
    decrypting: 'Decrypting',
    paused: 'Paused',
    failed: 'Failed',
    completed: 'Done',
}

function isDownloadTransfer(transfer: TransferHistoryEntry): transfer is DownloadTransfer {
    return 'direction' in transfer && transfer.direction === 'download'
}

function integrityLabel(transfer: TransferHistoryEntry): string | null {
    if (!isDownloadTransfer(transfer) || !transfer.integrity) return null
    if (transfer.integrity.status === 'verified') {
        return `SHA-256 verified (${transfer.integrity.actualChecksum?.slice(0, 12)}...)`
    }
    return 'SHA-256 header missing'
}

export function TransferQueuePanel({
    transfers,
    onPause,
    onResume,
    onRetry,
    onRemove,
    onPauseAll,
    onResumeAll,
}: TransferQueuePanelProps) {
    if (transfers.length === 0) return null

    const canPauseAll = transfers.some((transfer) =>
        transfer.status === 'queued' || transfer.status === 'encrypting' || transfer.status === 'uploading',
    )
    const canResumeAll = transfers.some((transfer) => !isDownloadTransfer(transfer) && (transfer.status === 'paused' || transfer.status === 'failed'))

    return (
        <section className="transfer-queue" aria-label="Transfer history">
            <div className="transfer-queue__head">
                <div>
                    <h2 className="transfer-queue__title">Transfers</h2>
                    <p className="transfer-queue__meta">
                        {transfers.length} {transfers.length === 1 ? 'file' : 'files'} in history
                    </p>
                </div>
                <div className="transfer-queue__actions">
                    <button className="transfer-queue__button" type="button" onClick={onPauseAll} disabled={!canPauseAll}>
                        Pause all
                    </button>
                    <button className="transfer-queue__button" type="button" onClick={onResumeAll} disabled={!canResumeAll}>
                        Resume all
                    </button>
                </div>
            </div>

            <div className="transfer-queue__list">
                {transfers.map((transfer) => {
                    const download = isDownloadTransfer(transfer)
                    const isRunning = transfer.status === 'encrypting' || transfer.status === 'uploading'
                    const canPause = !download && (transfer.status === 'queued' || isRunning)
                    const canResume = !download && transfer.status === 'paused'
                    const canRetry = !download && transfer.status === 'failed'
                    const canRemove =
                        download || transfer.status === 'paused' || transfer.status === 'failed' || transfer.status === 'queued' || transfer.status === 'completed'
                    const integrity = integrityLabel(transfer)
                    const integrityStatus = isDownloadTransfer(transfer) ? transfer.integrity?.status : null

                    return (
                        <article className="transfer-queue__row" key={transfer.id}>
                            <div className="transfer-queue__file">
                                <span className="transfer-queue__name" title={transfer.name}>
                                    {transfer.name}
                                </span>
                                <span className="transfer-queue__detail">
                                    {download ? 'Download' : 'Upload'} · {formatBytes(transfer.size)} · attempt {Math.max(transfer.attempts, 1)}
                                </span>
                                {integrity && <span className={`transfer-queue__integrity transfer-queue__integrity--${integrityStatus}`}>{integrity}</span>}
                                {transfer.error && <span className="transfer-queue__error">{transfer.error}</span>}
                            </div>
                            <span className={`transfer-queue__status transfer-queue__status--${transfer.status}`}>
                                {STATUS_LABELS[transfer.status]}
                            </span>
                            <div className="transfer-queue__row-actions">
                                {canPause && (
                                    <button className="transfer-queue__icon-button" type="button" onClick={() => onPause(transfer.id)}>
                                        Pause
                                    </button>
                                )}
                                {canResume && (
                                    <button className="transfer-queue__icon-button" type="button" onClick={() => onResume(transfer.id)}>
                                        Resume
                                    </button>
                                )}
                                {canRetry && (
                                    <button className="transfer-queue__icon-button" type="button" onClick={() => onRetry(transfer.id)}>
                                        Retry
                                    </button>
                                )}
                                {canRemove && (
                                    <button className="transfer-queue__icon-button" type="button" onClick={() => onRemove(transfer.id)}>
                                        Remove
                                    </button>
                                )}
                            </div>
                        </article>
                    )
                })}
            </div>
        </section>
    )
}
