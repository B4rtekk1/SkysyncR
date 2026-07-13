import { useCallback, type Dispatch, type SetStateAction } from 'react'
import {
    renameFile,
    restoreFile,
    shareFile,
    softDeleteFile,
    type ApiFile,
} from '../../../api/files'
import { saveFavouriteIds, saveLocalFileMetadata } from '../storage'
import type { Item } from '../types'

type UseFileActionsOptions = {
    setItems: Dispatch<SetStateAction<Item[]>>
    setStorageItems: Dispatch<SetStateAction<ApiFile[]>>
    setError: Dispatch<SetStateAction<string | null>>
    setShareItem: Dispatch<SetStateAction<Item | null>>
    setShareLoading: Dispatch<SetStateAction<boolean>>
    setFavouriteIds: Dispatch<SetStateAction<Set<string>>>
    refreshQuota: () => Promise<void>
}

export function useFileActions({
    setItems,
    setStorageItems,
    setError,
    setShareItem,
    setShareLoading,
    setFavouriteIds,
    refreshQuota,
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

    const handleRename = useCallback(
        async (item: Item, filename: string) => {
            const previousName = item.filename
            const nextName = filename.trim()
            if (!nextName || nextName === previousName) return

            setError(null)
            setItems((prev) =>
                prev.map((current) =>
                    current.id === item.id ? { ...current, filename: nextName, updated_at: new Date().toISOString() } : current,
                ),
            )

            try {
                const renamed = await renameFile(item.id, nextName)
                const visibleRenamed = { ...renamed, filename: nextName, mime_type: item.mime_type }
                saveLocalFileMetadata(item.id, {
                    filename: nextName,
                    mime_type: item.mime_type,
                })
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
        [setError, setItems, setStorageItems],
    )

    const handleShare = useCallback(
        (item: Item) => {
            setError(null)
            setShareItem(item)
        },
        [setError, setShareItem],
    )

    const setFileSharing = useCallback(
        async (item: Item, isPublic: boolean) => {
            setShareLoading(true)
            setError(null)
            try {
                const shared = await shareFile(item.id, isPublic)
                const visibleShared = { ...shared, filename: item.filename, mime_type: item.mime_type }
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
        handleRename,
        handleShare,
        setFileSharing,
        toggleFavourite,
    }
}
