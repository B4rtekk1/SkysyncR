import { useCallback, type Dispatch, type SetStateAction } from 'react'
import {
    permanentlyDeleteFile,
    renameFile,
    restoreFile,
    shareFile,
    softDeleteFile,
    type ApiFile,
} from '../../../api/files'
import { encryptTextEnvelope, unwrapFileKeyForUser } from '../../../crypto/fileEncryption'
import { saveFavouriteIds } from '../storage'
import type { Item, ShareableItem } from '../types'

type UseFileActionsOptions = {
    setItems: Dispatch<SetStateAction<Item[]>>
    setStorageItems: Dispatch<SetStateAction<ApiFile[]>>
    setError: Dispatch<SetStateAction<string | null>>
    setShareItem: Dispatch<SetStateAction<ShareableItem | null>>
    setShareLoading: Dispatch<SetStateAction<boolean>>
    setFavouriteIds: Dispatch<SetStateAction<Set<string>>>
    refreshQuota: () => Promise<void>
    privateKey: CryptoKey | null
}

export function useFileActions({
    setItems,
    setStorageItems,
    setError,
    setShareItem,
    setShareLoading,
    setFavouriteIds,
    refreshQuota,
    privateKey,
}: UseFileActionsOptions) {
    const handleDelete = useCallback(
        async (id: string) => {
            setItems((prev) => prev.filter((i) => i.id !== id))
            try {
                await softDeleteFile(id)
                await refreshQuota()
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not move that file to trash.')
            }
        },
        [refreshQuota, setError, setItems],
    )

    const handleRestore = useCallback(
        async (id: string) => {
            setItems((prev) => prev.filter((i) => i.id !== id))
            try {
                await restoreFile(id)
                await refreshQuota()
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not restore that file.')
            }
        },
        [refreshQuota, setError, setItems],
    )

    const handlePermanentDelete = useCallback(
        async (id: string) => {
            const confirmed = window.confirm('Permanently delete this file? This cannot be undone.')
            if (!confirmed) return

            setItems((prev) => prev.filter((i) => i.id !== id))
            setStorageItems((prev) => prev.filter((i) => i.id !== id))
            setFavouriteIds((prev) => {
                const next = new Set(prev)
                next.delete(id)
                saveFavouriteIds(next)
                return next
            })

            try {
                await permanentlyDeleteFile(id)
                await refreshQuota()
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not permanently delete that file.')
            }
        },
        [refreshQuota, setError, setFavouriteIds, setItems, setStorageItems],
    )

    const handleRename = useCallback(
        async (item: Item, filename: string) => {
            const previousName = item.filename
            const nextName = filename.trim()
            if (!nextName || nextName === previousName) return

            setError(null)

            if (!privateKey) {
                setError('Private key is locked. Sign in again to rename encrypted files.')
                return
            }

            setItems((prev) =>
                prev.map((current) =>
                    current.id === item.id ? { ...current, filename: nextName, updated_at: new Date().toISOString() } : current,
                ),
            )

            try {
                const fileKey = await unwrapFileKeyForUser(item.encrypted_key, privateKey)
                const encryptedName = await encryptTextEnvelope(nextName, fileKey)
                const renamed = await renameFile(item.id, encryptedName)
                const visibleRenamed = { ...renamed, filename: nextName, mime_type: item.mime_type, note: item.note }
                setItems((prev) => prev.map((current) => (current.id === item.id ? visibleRenamed : current)))
                setStorageItems((prev) => prev.map((current) => (current.id === item.id ? visibleRenamed : current)))
            } catch (e) {
                setItems((prev) =>
                    prev.map((current) =>
                        current.id === item.id ? { ...current, filename: previousName, updated_at: item.updated_at } : current,
                    ),
                )
                setError(e instanceof Error ? e.message : 'Could not rename that file.')
                throw e
            }
        },
        [privateKey, setError, setItems, setStorageItems],
    )

    const handleShare = useCallback(
        (item: Item) => {
            setError(null)
            setShareItem(item)
        },
        [setError, setShareItem],
    )

    const setFileSharing = useCallback(
        async (item: Item, isPublic: boolean, expiresInSeconds?: number | null) => {
            setShareLoading(true)
            setError(null)
            try {
                const shared = await shareFile(item.id, isPublic, expiresInSeconds)
                const visibleShared = { ...shared, filename: item.filename, mime_type: item.mime_type, note: item.note }
                setItems((prev) => prev.map((current) => (current.id === item.id ? visibleShared : current)))
                setStorageItems((prev) => prev.map((current) => (current.id === item.id ? visibleShared : current)))
                setShareItem(visibleShared)
                return visibleShared
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not update sharing for that file.')
                throw e
            } finally {
                setShareLoading(false)
            }
        },
        [setError, setItems, setShareItem, setShareLoading, setStorageItems],
    )

    const toggleFavourite = useCallback(
        (id: string) => {
            setFavouriteIds((prev) => {
                const next = new Set(prev)
                if (next.has(id)) {
                    next.delete(id)
                } else {
                    next.add(id)
                }
                saveFavouriteIds(next)
                return next
            })
        },
        [setFavouriteIds],
    )

    return {
        handleDelete,
        handleRestore,
        handlePermanentDelete,
        handleRename,
        handleShare,
        setFileSharing,
        toggleFavourite,
    }
}
