import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { uploadFile, type ApiFile } from '../../../api/files'
import {
    encryptedFileFormatNonce,
    encryptFileStream,
    encryptTextEnvelope,
    generateFileKey,
    wrapFileKeyForUser,
} from '../../../crypto/fileEncryption'
import type { Item } from '../types'

type UseFileUploadOptions = {
    publicKey: string | null
    folderId?: string | null
    setItems: Dispatch<SetStateAction<Item[]>>
    setPendingIds: Dispatch<SetStateAction<Set<string>>>
    setError: Dispatch<SetStateAction<string | null>>
    refreshQuota: () => Promise<void>
}

export function useFileUpload({
    publicKey,
    folderId,
    setItems,
    setPendingIds,
    setError,
    refreshQuota,
}: UseFileUploadOptions) {
    const ingestFileArray = useCallback(
        async (files: File[]) => {
            const savedItems: ApiFile[] = []

            for (const file of files) {
                const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`
                const now = new Date().toISOString()
                const placeholder: ApiFile = {
                    id: tempId,
                    filename: file.name,
                    storage_path: '',
                    mime_type: file.type || null,
                    size_bytes: file.size,
                    folder_id: folderId ?? null,
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

                setItems((prev) => [placeholder, ...prev])
                setPendingIds((prev) => new Set(prev).add(tempId))

                if (!publicKey) {
                    setItems((prev) => prev.filter((i) => i.id !== tempId))
                    setPendingIds((prev) => {
                        const next = new Set(prev)
                        next.delete(tempId)
                        return next
                    })
                    setError('Encryption key unavailable. Sign in again before uploading.')
                    continue
                }

                try {
                    const key = await generateFileKey()
                    const encryptedFilename = await encryptTextEnvelope(file.name, key)
                    const wrappedKey = await wrapFileKeyForUser(key, publicKey)
                    const originalMimeType = file.type || null
                    const encryptedMimeType = originalMimeType
                        ? await encryptTextEnvelope(originalMimeType, key)
                        : null

                    const uploadParams = {
                        encryptedFile: encryptFileStream(file, key),
                        storedFilename: encryptedFilename,
                        storedMimeType: encryptedMimeType,
                        wrappedKey,
                        encryptionNonce: encryptedFileFormatNonce(),
                    }
                    const saved = await uploadFile(
                        folderId ? { ...uploadParams, folderId } : uploadParams,
                    )

                    const visibleSaved = {
                        ...saved,
                        filename: file.name,
                        mime_type: file.type || null,
                    }
                    savedItems.push(visibleSaved)
                    setItems((prev) => prev.map((i) => (i.id === tempId ? visibleSaved : i)))
                } catch (e) {
                    setItems((prev) => prev.filter((i) => i.id !== tempId))
                    setError(e instanceof Error ? e.message : `Failed to upload ${file.name}.`)
                } finally {
                    setPendingIds((prev) => {
                        const next = new Set(prev)
                        next.delete(tempId)
                        return next
                    })
                }
            }

            await refreshQuota()
            return savedItems
        },
        [folderId, publicKey, refreshQuota, setError, setItems, setPendingIds],
    )

    const ingestFiles = useCallback(
        (fileList: FileList) => ingestFileArray(Array.from(fileList)),
        [ingestFileArray],
    )

    return { ingestFiles, ingestFileArray }
}
