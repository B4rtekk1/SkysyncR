import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { uploadFile, type ApiFile } from '../../../api/files'
import {
    encryptedFileFormatNonce,
    encryptFileStream,
    encryptTextEnvelope,
    generateFileKey,
    wrapFileKeyForUser,
} from '../../../crypto/fileEncryption'
import type { Item } from '../types'

export type UploadTransferStatus = 'queued' | 'encrypting' | 'uploading' | 'paused' | 'failed' | 'completed'

export type UploadTransfer = {
    id: string
    tempId: string
    name: string
    size: number
    status: UploadTransferStatus
    attempts: number
    error: string | null
    createdAt: number
    updatedAt: number
}

type UploadJob = {
    id: string
    tempId: string
    file: File
    folderId: string | null
    controller: AbortController | null
    resolve: (file: ApiFile) => void
    reject: (error: Error) => void
}

type UseFileUploadOptions = {
    publicKey: string | null
    folderId?: string | null
    setItems: Dispatch<SetStateAction<Item[]>>
    setPendingIds: Dispatch<SetStateAction<Set<string>>>
    setError: Dispatch<SetStateAction<string | null>>
    refreshQuota: () => Promise<void>
}

function createAbortError() {
    return new DOMException('Transfer paused', 'AbortError')
}

function transferId() {
    return `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function pendingFile(file: File, tempId: string, folderId: string | null): ApiFile {
    const now = new Date().toISOString()
    return {
        id: tempId,
        filename: file.name,
        storage_path: '',
        mime_type: file.type || null,
        size_bytes: file.size,
        folder_id: folderId,
        note: null,
        is_deleted: false,
        is_public: false,
        share_token: null,
        share_expires_at: null,
        share_download_limit: null,
        share_download_count: 0,
        is_favourite: false,
        encrypted_key: '',
        encryption_nonce: '',
        created_at: now,
        updated_at: now,
        deleted_at: null,
    }
}

function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === 'AbortError'
}

export function useFileUpload({
    publicKey,
    folderId,
    setItems,
    setPendingIds,
    setError,
    refreshQuota,
}: UseFileUploadOptions) {
    const [transfers, setTransfers] = useState<UploadTransfer[]>([])
    const jobsRef = useRef(new Map<string, UploadJob>())
    const activeRef = useRef<string | null>(null)
    const publicKeyRef = useRef(publicKey)
    const refreshQuotaRef = useRef(refreshQuota)

    useEffect(() => {
        publicKeyRef.current = publicKey
    }, [publicKey])

    useEffect(() => {
        refreshQuotaRef.current = refreshQuota
    }, [refreshQuota])

    const updateTransfer = useCallback((id: string, patch: Partial<UploadTransfer>) => {
        setTransfers((prev) =>
            prev.map((transfer) =>
                transfer.id === id ? { ...transfer, ...patch, updatedAt: Date.now() } : transfer,
            ),
        )
    }, [])

    const removePlaceholder = useCallback(
        (tempId: string) => {
            setItems((prev) => prev.filter((item) => item.id !== tempId))
            setPendingIds((prev) => {
                const next = new Set(prev)
                next.delete(tempId)
                return next
            })
        },
        [setItems, setPendingIds],
    )

    const runJob = useCallback(
        async (job: UploadJob) => {
            activeRef.current = job.id
            const controller = new AbortController()
            job.controller = controller

            try {
                const key = await generateFileKey()
                controller.signal.throwIfAborted()
                updateTransfer(job.id, { status: 'encrypting', error: null })

                const encryptedFilename = await encryptTextEnvelope(job.file.name, key)
                const wrappedKey = await wrapFileKeyForUser(key, publicKeyRef.current ?? '')
                const encryptedMimeType = job.file.type ? await encryptTextEnvelope(job.file.type, key) : null
                controller.signal.throwIfAborted()

                updateTransfer(job.id, { status: 'uploading', error: null })
                const uploadParams = {
                    encryptedFile: encryptFileStream(job.file, key),
                    storedFilename: encryptedFilename,
                    storedMimeType: encryptedMimeType,
                    wrappedKey,
                    encryptionNonce: encryptedFileFormatNonce(),
                    signal: controller.signal,
                }
                const saved = await uploadFile(
                    job.folderId ? { ...uploadParams, folderId: job.folderId } : uploadParams,
                )

                const visibleSaved = {
                    ...saved,
                    filename: job.file.name,
                    mime_type: job.file.type || null,
                }

                setItems((prev) => prev.map((item) => (item.id === job.tempId ? visibleSaved : item)))
                setPendingIds((prev) => {
                    const next = new Set(prev)
                    next.delete(job.tempId)
                    return next
                })
                updateTransfer(job.id, { status: 'completed', error: null })
                jobsRef.current.delete(job.id)
                job.resolve(visibleSaved)
                void refreshQuotaRef.current()
            } catch (error) {
                if (isAbortError(error)) {
                    updateTransfer(job.id, { status: 'paused', error: null })
                    return
                }

                const message = error instanceof Error ? error.message : `Failed to upload ${job.file.name}.`
                updateTransfer(job.id, { status: 'failed', error: message })
                setError(message)
                job.reject(new Error(message))
            } finally {
                job.controller = null
                if (activeRef.current === job.id) activeRef.current = null
            }
        },
        [setError, setItems, setPendingIds, updateTransfer],
    )

    useEffect(() => {
        if (activeRef.current) return
        if (!publicKeyRef.current) return

        const next = transfers.find((transfer) => transfer.status === 'queued')
        if (!next) return

        const job = jobsRef.current.get(next.id)
        if (!job) return

        setTransfers((prev) =>
            prev.map((transfer) =>
                transfer.id === next.id
                    ? { ...transfer, status: 'encrypting', attempts: transfer.attempts + 1, error: null, updatedAt: Date.now() }
                    : transfer,
            ),
        )
        void runJob(job)
    }, [runJob, transfers])

    const ingestFileArray = useCallback(
        async (files: File[]) => {
            if (!publicKeyRef.current) {
                setError('Encryption key unavailable. Sign in again before uploading.')
                return []
            }

            const queued = files.map((file) => {
                const id = transferId()
                const tempId = `pending-${id}`
                const currentFolderId = folderId ?? null
                const transfer: UploadTransfer = {
                    id,
                    tempId,
                    name: file.name,
                    size: file.size,
                    status: 'queued',
                    attempts: 0,
                    error: null,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                }

                const promise = new Promise<ApiFile>((resolve, reject) => {
                    jobsRef.current.set(id, {
                        id,
                        tempId,
                        file,
                        folderId: currentFolderId,
                        controller: null,
                        resolve,
                        reject,
                    })
                })

                setItems((prev) => [pendingFile(file, tempId, currentFolderId), ...prev])
                setPendingIds((prev) => new Set(prev).add(tempId))

                return { transfer, promise }
            })

            setTransfers((prev) => [...queued.map((entry) => entry.transfer), ...prev])
            const settled = await Promise.allSettled(queued.map((entry) => entry.promise))
            return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
        },
        [folderId, setError, setItems, setPendingIds],
    )

    const ingestFiles = useCallback(
        (fileList: FileList) => ingestFileArray(Array.from(fileList)),
        [ingestFileArray],
    )

    const pauseTransfer = useCallback(
        (id: string) => {
            const job = jobsRef.current.get(id)
            if (!job) return

            if (job.controller) {
                job.controller.abort(createAbortError())
                return
            }

            updateTransfer(id, { status: 'paused', error: null })
        },
        [updateTransfer],
    )

    const resumeTransfer = useCallback(
        (id: string) => {
            if (!jobsRef.current.has(id)) return
            updateTransfer(id, { status: 'queued', error: null })
        },
        [updateTransfer],
    )

    const retryTransfer = useCallback(
        (id: string) => {
            if (!jobsRef.current.has(id)) return
            updateTransfer(id, { status: 'queued', error: null })
        },
        [updateTransfer],
    )

    const removeTransfer = useCallback(
        (id: string) => {
            const job = jobsRef.current.get(id)
            if (!job) return

            if (job.controller) {
                job.controller.abort(createAbortError())
            }

            jobsRef.current.delete(id)
            removePlaceholder(job.tempId)
            setTransfers((prev) => prev.filter((transfer) => transfer.id !== id))
            job.reject(new Error('Transfer removed.'))
        },
        [removePlaceholder],
    )

    const pauseAllTransfers = useCallback(() => {
        transfers.forEach((transfer) => {
            if (transfer.status === 'queued' || transfer.status === 'encrypting' || transfer.status === 'uploading') {
                pauseTransfer(transfer.id)
            }
        })
    }, [pauseTransfer, transfers])

    const resumeAllTransfers = useCallback(() => {
        transfers.forEach((transfer) => {
            if (transfer.status === 'paused' || transfer.status === 'failed') {
                resumeTransfer(transfer.id)
            }
        })
    }, [resumeTransfer, transfers])

    return {
        ingestFiles,
        ingestFileArray,
        transfers,
        pauseTransfer,
        resumeTransfer,
        retryTransfer,
        removeTransfer,
        pauseAllTransfers,
        resumeAllTransfers,
    }
}
