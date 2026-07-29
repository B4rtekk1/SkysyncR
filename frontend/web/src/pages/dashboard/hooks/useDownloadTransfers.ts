import { useCallback, useState } from 'react'
import type { IntegrityVerificationResult } from '../../../api/files'

export type DownloadTransferStatus = 'downloading' | 'verifying' | 'decrypting' | 'completed' | 'failed'

export type DownloadTransfer = {
    id: string
    direction: 'download'
    name: string
    size: number
    status: DownloadTransferStatus
    attempts: number
    error: string | null
    integrity: IntegrityVerificationResult | null
    createdAt: number
    updatedAt: number
}

function transferId() {
    return crypto.randomUUID?.() ?? `download-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useDownloadTransfers() {
    const [transfers, setTransfers] = useState<DownloadTransfer[]>([])

    const startDownloadTransfer = useCallback((name: string, size: number) => {
        const transfer: DownloadTransfer = {
            id: transferId(),
            direction: 'download',
            name,
            size,
            status: 'downloading',
            attempts: 1,
            error: null,
            integrity: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }
        setTransfers((prev) => [transfer, ...prev].slice(0, 12))
        return transfer.id
    }, [])

    const updateDownloadTransfer = useCallback((id: string, patch: Partial<DownloadTransfer>) => {
        setTransfers((prev) =>
            prev.map((transfer) =>
                transfer.id === id ? { ...transfer, ...patch, updatedAt: Date.now() } : transfer,
            ),
        )
    }, [])

    const removeDownloadTransfer = useCallback((id: string) => {
        setTransfers((prev) => prev.filter((transfer) => transfer.id !== id))
    }, [])

    return {
        downloadTransfers: transfers,
        startDownloadTransfer,
        updateDownloadTransfer,
        removeDownloadTransfer,
    }
}
