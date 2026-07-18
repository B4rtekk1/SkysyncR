import { useState, type Dispatch, type SetStateAction } from 'react'
import {
    createFolder,
    renameFolder,
    setFolderFavourite,
    shareFolder,
    type ApiFolder,
} from '../../../api/files'
import {
    encryptTextEnvelope,
    generateFileKey,
    unwrapFileKeyForUser,
    wrapFileKeyForUser,
} from '../../../crypto/fileEncryption'
import type { ShareableItem, ViewKey } from '../types'

type UseFolderActionsOptions = {
    publicKey: string | null
    privateKey: CryptoKey | null
    setView: Dispatch<SetStateAction<ViewKey>>
    activeFolderId: string | null
    setActiveFolderId: Dispatch<SetStateAction<string | null>>
    setFolders: Dispatch<SetStateAction<ApiFolder[]>>
    folderFavouriteIds: Set<string>
    setFolderFavouriteIds: Dispatch<SetStateAction<Set<string>>>
    setShareItem: Dispatch<SetStateAction<ShareableItem | null>>
    setShareLoading: Dispatch<SetStateAction<boolean>>
    setError: Dispatch<SetStateAction<string | null>>
    setQuery: Dispatch<SetStateAction<string>>
}

export function useFolderActions({
    publicKey,
    privateKey,
    setView,
    activeFolderId,
    setActiveFolderId,
    setFolders,
    folderFavouriteIds,
    setFolderFavouriteIds,
    setShareItem,
    setShareLoading,
    setError,
    setQuery,
}: UseFolderActionsOptions) {
    const [folderTrail, setFolderTrail] = useState<ApiFolder[]>([])
    const [folderCreateOpen, setFolderCreateOpen] = useState(false)
    const [folderNameDraft, setFolderNameDraft] = useState('')
    const [folderDescriptionDraft, setFolderDescriptionDraft] = useState('')
    const [folderSaving, setFolderSaving] = useState(false)

    function openFolder(folder: ApiFolder) {
        setView('all')
        setActiveFolderId(folder.id)
        setFolderTrail((current) => [...current, folder])
        setQuery('')
    }

    function openFolderRoot() {
        setActiveFolderId(null)
        setFolderTrail([])
        setQuery('')
    }

    function openFolderAt(folder: ApiFolder, index: number) {
        const nextTrail = folderTrail.slice(0, index + 1)
        setFolderTrail(nextTrail)
        setActiveFolderId(folder.id)
        setQuery('')
    }

    function openFolderParent() {
        setFolderTrail((current) => {
            const next = current.slice(0, -1)
            setActiveFolderId(next.at(-1)?.id ?? null)
            return next
        })
        setQuery('')
    }

    function closeFolderCreate() {
        setFolderCreateOpen(false)
        setFolderNameDraft('')
        setFolderDescriptionDraft('')
    }

    async function handleCreateFolder() {
        const name = folderNameDraft.trim()
        const description = folderDescriptionDraft.trim()
        if (!name || folderSaving) return

        setFolderSaving(true)
        setError(null)
        if (!publicKey) {
            setError('Encryption key unavailable. Sign in again before creating folders.')
            setFolderSaving(false)
            return
        }

        try {
            const folderKey = await generateFileKey()
            const folder = await createFolder({
                name: await encryptTextEnvelope(name, folderKey),
                description: description ? await encryptTextEnvelope(description, folderKey) : null,
                wrappedKey: await wrapFileKeyForUser(folderKey, publicKey),
                parentFolderId: activeFolderId,
            })
            const visibleFolder = { ...folder, name, description: description || null }
            setFolders((current) => [...current, visibleFolder].sort((a, b) => a.name.localeCompare(b.name)))
            closeFolderCreate()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not create the folder.')
        } finally {
            setFolderSaving(false)
        }
    }

    async function handleRenameFolder(folder: ApiFolder, name: string, description: string | null) {
        const previousName = folder.name
        const previousDescription = folder.description ?? null
        const nextName = name.trim()
        const nextDescription = description?.trim() || null
        if (!nextName || (nextName === previousName && nextDescription === previousDescription)) return

        setError(null)
        if (folder.encrypted_key && !privateKey) {
            setError('Private key is locked. Sign in again to update encrypted folders.')
            return
        }
        const unlockedPrivateKey = privateKey

        setFolders((current) =>
            current
                .map((item) =>
                    item.id === folder.id ? { ...item, name: nextName, description: nextDescription, updated_at: new Date().toISOString() } : item,
                )
                .sort((a, b) => a.name.localeCompare(b.name)),
        )
        setFolderTrail((current) =>
            current.map((item) =>
                item.id === folder.id ? { ...item, name: nextName, description: nextDescription, updated_at: new Date().toISOString() } : item,
            ),
        )

        try {
            let storedName = nextName
            let storedDescription = nextDescription
            if (folder.encrypted_key && unlockedPrivateKey) {
                const folderKey = await unwrapFileKeyForUser(folder.encrypted_key, unlockedPrivateKey)
                storedName = await encryptTextEnvelope(nextName, folderKey)
                storedDescription = nextDescription ? await encryptTextEnvelope(nextDescription, folderKey) : null
            }

            const renamed = await renameFolder(folder.id, storedName, storedDescription)
            const visibleRenamed = { ...renamed, name: nextName, description: nextDescription, encrypted_key: folder.encrypted_key }
            setFolders((current) =>
                current.map((item) => (item.id === folder.id ? visibleRenamed : item)).sort((a, b) => a.name.localeCompare(b.name)),
            )
            setFolderTrail((current) => current.map((item) => (item.id === folder.id ? visibleRenamed : item)))
            setShareItem((current) => {
                if (!current || 'filename' in current || current.id !== folder.id) return current
                return visibleRenamed
            })
        } catch (e) {
            setFolders((current) =>
                current
                    .map((item) =>
                        item.id === folder.id ? { ...item, name: previousName, description: previousDescription, updated_at: folder.updated_at } : item,
                    )
                    .sort((a, b) => a.name.localeCompare(b.name)),
            )
            setFolderTrail((current) =>
                current.map((item) =>
                    item.id === folder.id ? { ...item, name: previousName, description: previousDescription, updated_at: folder.updated_at } : item,
                ),
            )
            setError(e instanceof Error ? e.message : 'Could not update that folder.')
        }
    }

    function handleShareFolder(folder: ApiFolder) {
        setError(null)
        setShareItem(folder)
    }

    async function setFolderSharing(folder: ApiFolder, isPublic: boolean) {
        setShareLoading(true)
        setError(null)
        try {
            const shared = await shareFolder(folder.id, isPublic)
            const visibleShared = { ...shared, name: folder.name, description: folder.description, encrypted_key: folder.encrypted_key }
            setFolders((current) => current.map((item) => (item.id === folder.id ? visibleShared : item)))
            setShareItem(visibleShared)
            return visibleShared
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not update sharing for that folder.')
            throw e
        } finally {
            setShareLoading(false)
        }
    }

    async function toggleFolderFavourite(id: string) {
        const nextIsFavourite = !folderFavouriteIds.has(id)
        setFolderFavouriteIds((prev) => {
            const next = new Set(prev)
            if (nextIsFavourite) {
                next.add(id)
            } else {
                next.delete(id)
            }
            return next
        })
        setFolders((current) =>
            current.map((folder) => (folder.id === id ? { ...folder, is_favourite: nextIsFavourite } : folder)),
        )
        setFolderTrail((current) =>
            current.map((folder) => (folder.id === id ? { ...folder, is_favourite: nextIsFavourite } : folder)),
        )

        try {
            await setFolderFavourite(id, nextIsFavourite)
        } catch (e) {
            setFolderFavouriteIds((prev) => {
                const next = new Set(prev)
                if (nextIsFavourite) {
                    next.delete(id)
                } else {
                    next.add(id)
                }
                return next
            })
            setFolders((current) =>
                current.map((folder) => (folder.id === id ? { ...folder, is_favourite: !nextIsFavourite } : folder)),
            )
            setFolderTrail((current) =>
                current.map((folder) => (folder.id === id ? { ...folder, is_favourite: !nextIsFavourite } : folder)),
            )
            setError(e instanceof Error ? e.message : 'Could not update favourite folder.')
        }
    }

    return {
        folderTrail,
        setFolderTrail,
        folderCreateOpen,
        setFolderCreateOpen,
        folderNameDraft,
        setFolderNameDraft,
        folderDescriptionDraft,
        setFolderDescriptionDraft,
        folderSaving,
        openFolder,
        openFolderRoot,
        openFolderAt,
        openFolderParent,
        closeFolderCreate,
        handleCreateFolder,
        handleRenameFolder,
        handleShareFolder,
        setFolderSharing,
        toggleFolderFavourite,
    }
}
