import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
    appendResumableUploadChunk,
    cancelResumableUpload,
    completeResumableUpload,
    getResumableUploadStatus,
    startResumableUpload,
    type ApiFile,
} from '../../../api/files'
import {
    deterministicEncryptedFileSize,
    encryptedFileFormatNonce,
    encryptedFileHeader,
    encryptedPlaintextChunkSize,
    encryptFileChunk,
    encryptTextEnvelope,
    exportRawKey,
    generateFileKey,
    importRawFileKey,
    resumableChunkIndexForOffset,
    resumableUploadNonceSeed,
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

type PersistedUploadJob = {
    id: string
    tempId: string
    file: File
    folderId: string | null
    rawKeyBase64: string
    nonceSeedBase64: string
    storedFilename: string
    storedMimeType: string | null
    wrappedKeyBase64: string
    encryptedSize: number
    transfer: UploadTransfer
}

type UploadJob = PersistedUploadJob & {
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

const DB_NAME = 'skysyncr-transfer-queue'
const DB_VERSION = 1
const STORE_NAME = 'uploads'

function createAbortError() {
    return new DOMException('Transfer paused', 'AbortError')
}

function transferId() {
    return crypto.randomUUID?.() ?? `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

function base64ToBuffer(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

function openQueueDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Unable to open transfer queue'))
    })
}

async function queueStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openQueueDb()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode)
        const request = run(tx.objectStore(STORE_NAME))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Unable to update transfer queue'))
        tx.oncomplete = () => db.close()
        tx.onerror = () => {
            db.close()
            reject(tx.error ?? new Error('Unable to update transfer queue'))
        }
    })
}

function loadPersistedJobs() {
    return queueStore<PersistedUploadJob[]>('readonly', (store) => store.getAll())
}

function savePersistedJob(job: PersistedUploadJob) {
    return queueStore<IDBValidKey>('readwrite', (store) => store.put(job))
}

function deletePersistedJob(id: string) {
    return queueStore<undefined>('readwrite', (store) => store.delete(id))
}

function toPersistedJob(job: UploadJob): PersistedUploadJob {
    const { controller, resolve, reject, ...persisted } = job
    void controller
    void resolve
    void reject
    return persisted
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
        const updatedAt = Date.now()
        setTransfers((prev) =>
            prev.map((transfer) =>
                transfer.id === id ? { ...transfer, ...patch, updatedAt } : transfer,
            ),
        )

        const job = jobsRef.current.get(id)
        if (job) {
            job.transfer = { ...job.transfer, ...patch, updatedAt }
            void savePersistedJob(toPersistedJob(job))
        }
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

    useEffect(() => {
        let cancelled = false
        void loadPersistedJobs()
            .then((persistedJobs) => {
                if (cancelled) return

                const restored = persistedJobs
                    .filter((job) => job.transfer.status !== 'completed')
                    .map((job): UploadJob => {
                        const status =
                            job.transfer.status === 'uploading' || job.transfer.status === 'encrypting'
                                ? 'queued'
                                : job.transfer.status
                        const transfer = { ...job.transfer, status, updatedAt: Date.now() }
                        return {
                            ...job,
                            transfer,
                            controller: null,
                            resolve: () => {},
                            reject: () => {},
                        }
                    })

                restored.forEach((job) => {
                    jobsRef.current.set(job.id, job)
                    void savePersistedJob(toPersistedJob(job))
                })
                setTransfers(restored.map((job) => job.transfer))
                setItems((prev) => {
                    const existing = new Set(prev.map((item) => item.id))
                    const placeholders = restored
                        .filter((job) => !existing.has(job.tempId))
                        .map((job) => pendingFile(job.file, job.tempId, job.folderId))
                    return [...placeholders, ...prev]
                })
                setPendingIds((prev) => {
                    const next = new Set(prev)
                    restored.forEach((job) => next.add(job.tempId))
                    return next
                })
            })
            .catch(() => {
                setError('Unable to restore the upload queue.')
            })

        return () => {
            cancelled = true
        }
    }, [setError, setItems, setPendingIds])

    const runJob = useCallback(
        async (job: UploadJob) => {
            activeRef.current = job.id
            const controller = new AbortController()
            job.controller = controller

            try {
                updateTransfer(job.id, { status: 'uploading', error: null })
                await startResumableUpload(job.id)
                let { offset } = await getResumableUploadStatus(job.id)
                controller.signal.throwIfAborted()

                const key = await importRawFileKey(base64ToBuffer(job.rawKeyBase64))
                const header = encryptedFileHeader()
                if (offset < header.byteLength) {
                    const result = await appendResumableUploadChunk({
                        uploadId: job.id,
                        offset,
                        chunk: header.slice(offset),
                        signal: controller.signal,
                    })
                    offset = result.offset
                }

                let chunkIndex = resumableChunkIndexForOffset(job.file.size, offset)
                const plaintextChunkSize = encryptedPlaintextChunkSize()
                while (chunkIndex * plaintextChunkSize < job.file.size) {
                    controller.signal.throwIfAborted()
                    const start = chunkIndex * plaintextChunkSize
                    const encryptedChunk = await encryptFileChunk(
                        job.file.slice(start, start + plaintextChunkSize),
                        key,
                        base64ToBuffer(job.nonceSeedBase64),
                        chunkIndex,
                    )
                    const result = await appendResumableUploadChunk({
                        uploadId: job.id,
                        offset,
                        chunk: encryptedChunk,
                        signal: controller.signal,
                    })
                    offset = result.offset
                    chunkIndex += 1
                }

                const saved = await completeResumableUpload({
                    uploadId: job.id,
                    storedFilename: job.storedFilename,
                    storedMimeType: job.storedMimeType,
                    folderId: job.folderId,
                    wrappedKey: job.wrappedKeyBase64,
                    encryptionNonce: encryptedFileFormatNonce(),
                    sizeBytes: job.encryptedSize,
                    signal: controller.signal,
                })

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
                await deletePersistedJob(job.id)
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

        updateTransfer(next.id, { status: 'uploading', attempts: next.attempts + 1, error: null })
        void runJob(job)
    }, [runJob, transfers, updateTransfer])

    const ingestFileArray = useCallback(
        async (files: File[]) => {
            if (!publicKeyRef.current) {
                setError('Encryption key unavailable. Sign in again before uploading.')
                return []
            }

            const queued = await Promise.all(files.map(async (file) => {
                const id = transferId()
                const tempId = `pending-${id}`
                const currentFolderId = folderId ?? null
                const key = await generateFileKey()
                const rawKeyBase64 = arrayBufferToBase64(await exportRawKey(key))
                const nonceSeedBase64 = arrayBufferToBase64(resumableUploadNonceSeed())
                const storedFilename = await encryptTextEnvelope(file.name, key)
                const storedMimeType = file.type ? await encryptTextEnvelope(file.type, key) : null
                const wrappedKeyBase64 = arrayBufferToBase64(await wrapFileKeyForUser(key, publicKeyRef.current ?? ''))
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
                    const job: UploadJob = {
                        id,
                        tempId,
                        file,
                        folderId: currentFolderId,
                        rawKeyBase64,
                        nonceSeedBase64,
                        storedFilename,
                        storedMimeType,
                        wrappedKeyBase64,
                        encryptedSize: deterministicEncryptedFileSize(file.size),
                        transfer,
                        controller: null,
                        resolve,
                        reject,
                    }
                    jobsRef.current.set(id, job)
                    void savePersistedJob(toPersistedJob(job))
                })

                setItems((prev) => [pendingFile(file, tempId, currentFolderId), ...prev])
                setPendingIds((prev) => new Set(prev).add(tempId))

                return { transfer, promise }
            }))

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
            void deletePersistedJob(id)
            void cancelResumableUpload(id)
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
