import type { UploadTransfer } from '../hooks/useFileUpload'
import { formatBytes } from '../fileUtils'
import './TransferQueuePanel.css'

type TransferQueuePanelProps = {
    transfers: UploadTransfer[]
    onPause: (id: string) => void
    onResume: (id: string) => void
    onRetry: (id: string) => void
    onRemove: (id: string) => void
    onPauseAll: () => void
    onResumeAll: () => void
}

const STATUS_LABELS: Record<UploadTransfer['status'], string> = {
    queued: 'Queued',
    encrypting: 'Encrypting',
    uploading: 'Uploading',
    paused: 'Paused',
    failed: 'Failed',
    completed: 'Synced',
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
    const activeTransfers = transfers.filter((transfer) => transfer.status !== 'completed')
    if (activeTransfers.length === 0) return null

    const canPauseAll = activeTransfers.some((transfer) =>
        transfer.status === 'queued' || transfer.status === 'encrypting' || transfer.status === 'uploading',
    )
    const canResumeAll = activeTransfers.some((transfer) => transfer.status === 'paused' || transfer.status === 'failed')

    return (
        <section className="transfer-queue" aria-label="Upload transfer queue">
            <div className="transfer-queue__head">
                <div>
                    <h2 className="transfer-queue__title">Transfers</h2>
                    <p className="transfer-queue__meta">
                        {activeTransfers.length} {activeTransfers.length === 1 ? 'file' : 'files'} in queue
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
                {activeTransfers.map((transfer) => {
                    const isRunning = transfer.status === 'encrypting' || transfer.status === 'uploading'
                    const canPause = transfer.status === 'queued' || isRunning
                    const canResume = transfer.status === 'paused'
                    const canRetry = transfer.status === 'failed'

                    return (
                        <article className="transfer-queue__row" key={transfer.id}>
                            <div className="transfer-queue__file">
                                <span className="transfer-queue__name" title={transfer.name}>
                                    {transfer.name}
                                </span>
                                <span className="transfer-queue__detail">
                                    {formatBytes(transfer.size)} · attempt {Math.max(transfer.attempts, 1)}
                                </span>
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
                                {(transfer.status === 'paused' || transfer.status === 'failed' || transfer.status === 'queued') && (
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
