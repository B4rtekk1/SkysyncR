import { useCallback, useEffect, useRef, useState } from 'react'
import {
    getStorageQuota,
    listFiles,
    listFolders,
    listSharedFilesWithMe,
    listTrash,
    type ApiFile,
    type ApiFolder,
    type StorageQuota,
} from '../../../api/files'
import { applySavedOrder, clearLegacyLocalFileMetadata, loadFavouriteIds } from '../storage'
import { decryptFilesMetadata, decryptFoldersMetadata } from '../encryptedMetadata'
import { migratePlaintextFileMetadata } from '../metadataMigration'
import type { Item, ViewKey } from '../types'

type RefreshQuotaOptions = {
    includeFiles?: boolean
}

type UseDashboardDataOptions = {
    view: ViewKey
    activeFolderId: string | null
    privateKey: CryptoKey | null
}

export function useDashboardData({ view, activeFolderId, privateKey }: UseDashboardDataOptions) {
    const [items, setItems] = useState<Item[]>([])
    const [folders, setFolders] = useState<ApiFolder[]>([])
    const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [quota, setQuota] = useState<StorageQuota | null>(null)
    const [storageItems, setStorageItems] = useState<ApiFile[]>([])
    const [favouriteIds, setFavouriteIds] = useState<Set<string>>(() => loadFavouriteIds())
    const [folderFavouriteIds, setFolderFavouriteIds] = useState<Set<string>>(new Set())
    const migratedMetadataIdsRef = useRef<Set<string>>(new Set())

    const scheduleMetadataMigration = useCallback((files: ApiFile[], key: CryptoKey) => {
        const pendingFiles = files.filter((file) => !migratedMetadataIdsRef.current.has(file.id))
        if (pendingFiles.length === 0) return

        for (const file of pendingFiles) {
            migratedMetadataIdsRef.current.add(file.id)
        }

        window.setTimeout(() => {
            void migratePlaintextFileMetadata(pendingFiles, key)
        }, 1000)
    }, [])

    const refreshQuota = useCallback(async (options: RefreshQuotaOptions = {}) => {
        const includeFiles = options.includeFiles ?? true

        try {
            if (!includeFiles) {
                setQuota(await getStorageQuota())
                return
            }

            const [quotaData, fileData] = await Promise.all([getStorageQuota(), listFiles()])
            const visibleFileData = privateKey ? await decryptFilesMetadata(fileData, privateKey) : fileData
            if (privateKey) scheduleMetadataMigration(fileData, privateKey)
            setQuota(quotaData)
            setStorageItems(visibleFileData)
            setFavouriteIds(new Set(fileData.filter((file) => file.is_favourite).map((file) => file.id)))
        } catch {
            setQuota(null)
        }
    }, [privateKey, scheduleMetadataMigration])

    useEffect(() => {
        clearLegacyLocalFileMetadata()
    }, [])

    useEffect(() => {
        const timeout = setTimeout(() => void refreshQuota({ includeFiles: false }), 0)
        return () => clearTimeout(timeout)
    }, [refreshQuota])

    useEffect(() => {
        let active = true

        async function loadDashboardData() {
            if (!active) return

            try {
                setLoading(true)
                setError(null)
                if (view === 'groups' || view === 'calendar') {
                    setFolders([])
                    setItems([])
                    return
                }

                if (!privateKey) return

                let fileData: ApiFile[]
                let folderData: ApiFolder[] = []

                if (view === 'all') {
                    const [files, foldersData] = await Promise.all([
                        listFiles(activeFolderId ?? undefined),
                        listFolders(activeFolderId ?? undefined),
                    ])
                    fileData = files
                    folderData = foldersData
                } else if (view === 'favourites') {
                    const [files, foldersData] = await Promise.all([
                        listFiles(),
                        listFolders(undefined, true),
                    ])
                    fileData = files
                    folderData = foldersData
                } else if (view === 'trash') {
                    fileData = await listTrash()
                    setFolders([])
                } else {
                    fileData = await listSharedFilesWithMe()
                    setFolders([])
                }

                if (active) {
                    const [visibleFileData, visibleFolderData] = await Promise.all([
                        decryptFilesMetadata(fileData, privateKey),
                        decryptFoldersMetadata(folderData, privateKey),
                    ])
                    if (view !== 'shared') scheduleMetadataMigration(fileData, privateKey)
                    setItems(applySavedOrder(visibleFileData, view))
                    setFolders(visibleFolderData)
                    if (view === 'all' || view === 'favourites') {
                        setStorageItems(visibleFileData as ApiFile[])
                        setFavouriteIds(new Set(fileData.filter((file) => file.is_favourite).map((file) => file.id)))
                        setFolderFavouriteIds(new Set(folderData.filter((folder) => folder.is_favourite).map((folder) => folder.id)))
                    }
                }
            } catch (e) {
                if (active) setError(e instanceof Error ? e.message : 'Could not load your files.')
            } finally {
                if (active) setLoading(false)
            }
        }

        void loadDashboardData()

        return () => {
            active = false
        }
    }, [activeFolderId, privateKey, scheduleMetadataMigration, view])

    function handleFileUpdated(updated: ApiFile) {
        const previousSize = storageItems.find((item) => item.id === updated.id)?.size_bytes ?? updated.size_bytes
        const sizeDelta = updated.size_bytes - previousSize

        setStorageItems((prev) =>
            prev.map((current) => {
                if (current.id !== updated.id) return current

                return { ...updated, filename: current.filename, mime_type: current.mime_type, note: current.note }
            }),
        )
        setItems((prev) =>
            prev.map((current) =>
                current.id === updated.id
                    ? { ...updated, filename: current.filename, mime_type: current.mime_type, note: current.note }
                    : current,
            ),
        )
        setQuota((current) =>
            current && sizeDelta !== 0 ? { ...current, used_bytes: current.used_bytes + sizeDelta } : current,
        )
    }

    return {
        items,
        setItems,
        folders,
        setFolders,
        pendingIds,
        setPendingIds,
        loading,
        error,
        setError,
        quota,
        setQuota,
        storageItems,
        setStorageItems,
        favouriteIds,
        setFavouriteIds,
        folderFavouriteIds,
        setFolderFavouriteIds,
        refreshQuota,
        handleFileUpdated,
    }
}
