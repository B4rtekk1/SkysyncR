import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { uploadFile, type ApiFile } from '../../../api/files'
import {
    encryptFile,
    generateFileKey,
    wrapFileKeyForUser,
} from '../../../crypto/fileEncryption'
import { saveLocalFileMetadata } from '../storage'
import type { Item } from '../types'

type UseFileUploadOptions = {
    publicKey: string | null
    setItems: Dispatch<SetStateAction<Item[]>>
    setPendingIds: Dispatch<SetStateAction<Set<string>>>
    setError: Dispatch<SetStateAction<string | null>>
    refreshQuota: () => Promise<void>
}

export function useFileUpload({
    publicKey,
    setItems,
    setPendingIds,
    setError,
    refreshQuota,
}: UseFileUploadOptions) {
    const ingestFiles = useCallback(
        async (fileList: FileList) => {
            for (const file of Array.from(fileList)) {
                const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`
                const now = new Date().toISOString()
                const placeholder: ApiFile = {
                    id: tempId,
                    filename: file.name,
                    storage_path: '',
                    mime_type: file.type || null,
                    size_bytes: file.size,
                    folder_id: null,
                    is_deleted: false,
                    is_public: false,
                    share_token: null,
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
                    const { ciphertext, nonce } = await encryptFile(file, key)
                    const wrappedKey = await wrapFileKeyForUser(key, publicKey)
                    const originalMimeType = file.type || null
                    const encryptedBlob = new Blob([ciphertext], { type: originalMimeType || 'application/octet-stream' })

                    const saved = await uploadFile({
                        encryptedFile: encryptedBlob,
                        originalFilename: file.name,
                        originalMimeType,
                        wrappedKey,
                        encryptionNonce: nonce.buffer as ArrayBuffer,
                    })

                    const visibleSaved = {
                        ...saved,
                        filename: file.name,
                        mime_type: file.type || null,
                    }
                    saveLocalFileMetadata(saved.id, {
                        filename: file.name,
                        mime_type: file.type || null,
                    })
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
        },
        [publicKey, refreshQuota, setError, setItems, setPendingIds],
    )

    return { ingestFiles }
}
