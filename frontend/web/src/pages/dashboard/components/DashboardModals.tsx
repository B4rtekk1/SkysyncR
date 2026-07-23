import { lazy, Suspense, useEffect, useState } from 'react'
import type { CurrentUserResponse } from '../../../api/users'
import { listFiles, listFolders, type ApiFolder } from '../../../api/files'
import { arrayBufferToBase64Url, exportRawKey, unwrapFileKeyForUser } from '../../../crypto/fileEncryption'
import { CreateFileModal } from './CreateFileModal'
import { CreateFolderModal } from './CreateFolderModal'
import { FileNoteModal } from './FileNoteModal'
import { MoveFileModal } from './MoveFileModal'
import { hasFileExtension } from '../createdFile'
import type { FilePreviewState, Group, Item, ShareableItem } from '../types'
import type { SettingsState } from '../../settingsPreferences'

const ImagePreviewModal = lazy(() =>
    import('../previews/ImagePreviewModal').then((module) => ({ default: module.ImagePreviewModal })),
)
const SettingsModal = lazy(() => import('../../Settings'))
const ShareFileModal = lazy(() =>
    import('./ShareFileModal').then((module) => ({ default: module.ShareFileModal })),
)

type DashboardModalsProps = {
    filePreview: FilePreviewState | null
    onCloseFilePreview: () => void
    onDownload: (item: Item) => void | Promise<void>
    onSaveTextFile: (item: Item, text: string) => Promise<void>
    settingsOpen: boolean
    currentUser: CurrentUserResponse | null
    onCloseSettings: () => void
    onSaveSettings: (profile: SettingsState) => void
    fileCreateOpen: boolean
    currentFolderName: string
    fileNameDraft: string
    fileSaving: boolean
    onFileNameChange: (value: string) => void
    onCreateFile: () => void
    onCloseFileCreate: () => void
    folderCreateOpen: boolean
    folderNameDraft: string
    folderDescriptionDraft: string
    folderSaving: boolean
    onFolderNameChange: (value: string) => void
    onFolderDescriptionChange: (value: string) => void
    onCreateFolder: () => void
    onCloseFolderCreate: () => void
    noteItem: Item | null
    noteSaving: boolean
    onCloseNote: () => void
    onSaveNote: (item: Item, note: string) => Promise<void>
    moveItem: Item | null
    moveSaving: boolean
    onCloseMove: () => void
    onMoveFile: (item: Item, folderId: string | null) => Promise<void>
    shareItem: ShareableItem | null
    shareLoading: boolean
    privateKey: CryptoKey | null
    groups: Group[]
    onCloseShare: () => void
    onSetFileSharing: (item: Item, isPublic: boolean, expiresInSeconds?: number | null, downloadLimit?: number | null) => Promise<unknown>
    onSetFolderSharing: (folder: ApiFolder, isPublic: boolean) => Promise<unknown>
}

function ModalFallback() {
    return (
        <div className="image-preview" role="presentation">
            <div className="image-preview__loading" role="status">
                <span className="spinner" />
                Loading...
            </div>
        </div>
    )
}

type FolderShareKeyring = {
    v: 1
    folders: Record<string, string>
    files: Record<string, string>
}

function encodeFolderShareKeyring(keyring: FolderShareKeyring): string {
    const bytes = new TextEncoder().encode(JSON.stringify(keyring))
    return arrayBufferToBase64Url(bytes)
}

async function exportShareKey(encryptedKey: string | null | undefined, privateKey: CryptoKey): Promise<string> {
    if (!encryptedKey) throw new Error('This item is missing an encryption key.')

    const itemKey = await unwrapFileKeyForUser(encryptedKey, privateKey)
    return arrayBufferToBase64Url(await exportRawKey(itemKey))
}

async function collectFolderShareKeyring(root: ApiFolder, privateKey: CryptoKey): Promise<FolderShareKeyring> {
    const keyring: FolderShareKeyring = { v: 1, folders: {}, files: {} }

    async function collect(folder: ApiFolder) {
        keyring.folders[folder.id] = await exportShareKey(folder.encrypted_key, privateKey)
        const [files, folders] = await Promise.all([listFiles(folder.id), listFolders(folder.id)])

        await Promise.all(
            files.map(async (file) => {
                keyring.files[file.id] = await exportShareKey(file.encrypted_key, privateKey)
            }),
        )
        await Promise.all(folders.map(collect))
    }

    await collect(root)
    return keyring
}

export function DashboardModals({
    filePreview,
    onCloseFilePreview,
    onDownload,
    onSaveTextFile,
    settingsOpen,
    currentUser,
    onCloseSettings,
    onSaveSettings,
    fileCreateOpen,
    currentFolderName,
    fileNameDraft,
    fileSaving,
    onFileNameChange,
    onCreateFile,
    onCloseFileCreate,
    folderCreateOpen,
    folderNameDraft,
    folderDescriptionDraft,
    folderSaving,
    onFolderNameChange,
    onFolderDescriptionChange,
    onCreateFolder,
    onCloseFolderCreate,
    noteItem,
    noteSaving,
    onCloseNote,
    onSaveNote,
    moveItem,
    moveSaving,
    onCloseMove,
    onMoveFile,
    shareItem,
    shareLoading,
    privateKey,
    groups,
    onCloseShare,
    onSetFileSharing,
    onSetFolderSharing,
}: DashboardModalsProps) {
    const [publicShareUrl, setPublicShareUrl] = useState<string | null>(null)

    useEffect(() => {
        let active = true

        async function buildShareUrl() {
            if (!shareItem?.is_public || !shareItem.share_token) {
                setPublicShareUrl(null)
                return
            }

            if (!privateKey) {
                setPublicShareUrl(null)
                return
            }

            try {
                if (!('filename' in shareItem)) {
                    const keyring = await collectFolderShareKeyring(shareItem, privateKey)
                    if (active) {
                        setPublicShareUrl(
                            `${window.location.origin}/share/folders/${shareItem.share_token}#keys=${encodeFolderShareKeyring(keyring)}`,
                        )
                    }
                    return
                }

                const fileKey = await unwrapFileKeyForUser(shareItem.encrypted_key, privateKey)
                const rawKey = await exportRawKey(fileKey)
                if (active) {
                    setPublicShareUrl(
                        `${window.location.origin}/share/${shareItem.share_token}#key=${arrayBufferToBase64Url(rawKey)}`,
                    )
                }
            } catch {
                if (active) setPublicShareUrl(null)
            }
        }

        void buildShareUrl()

        return () => {
            active = false
        }
    }, [privateKey, shareItem])

    return (
        <>
            {filePreview && (
                <Suspense fallback={<ModalFallback />}>
                    <ImagePreviewModal
                        key={filePreview.item.id}
                        preview={filePreview}
                        onClose={onCloseFilePreview}
                        onDownload={onDownload}
                        onSaveText={onSaveTextFile}
                    />
                </Suspense>
            )}
            {settingsOpen && (
                <Suspense fallback={<ModalFallback />}>
                    <SettingsModal
                        currentUser={currentUser}
                        onClose={onCloseSettings}
                        onSave={onSaveSettings}
                    />
                </Suspense>
            )}
            {fileCreateOpen && (
                <CreateFileModal
                    currentFolderName={currentFolderName}
                    fileNameDraft={fileNameDraft}
                    fileSaving={fileSaving}
                    canCreate={Boolean(fileNameDraft.trim() && hasFileExtension(fileNameDraft.trim()))}
                    onFileNameChange={onFileNameChange}
                    onCreate={onCreateFile}
                    onClose={onCloseFileCreate}
                />
            )}
            {folderCreateOpen && (
                <CreateFolderModal
                    currentFolderName={currentFolderName}
                    folderNameDraft={folderNameDraft}
                    folderDescriptionDraft={folderDescriptionDraft}
                    folderSaving={folderSaving}
                    onFolderNameChange={onFolderNameChange}
                    onFolderDescriptionChange={onFolderDescriptionChange}
                    onCreate={onCreateFolder}
                    onClose={onCloseFolderCreate}
                />
            )}
            {noteItem && (
                <FileNoteModal
                    item={noteItem}
                    saving={noteSaving}
                    onClose={onCloseNote}
                    onSave={onSaveNote}
                />
            )}
            {moveItem && (
                <MoveFileModal
                    item={moveItem}
                    privateKey={privateKey}
                    moving={moveSaving}
                    onClose={onCloseMove}
                    onMove={onMoveFile}
                />
            )}
            {shareItem && (
                <Suspense fallback={<ModalFallback />}>
                    <ShareFileModal
                        item={shareItem}
                        itemKind={'filename' in shareItem ? 'file' : 'folder'}
                        shareUrl={publicShareUrl}
                        loading={shareLoading}
                        privateKey={privateKey}
                        groups={groups}
                        onClose={onCloseShare}
                        onEnableShare={async (expiresInSeconds, downloadLimit) => {
                            if ('filename' in shareItem) {
                                await onSetFileSharing(shareItem, true, expiresInSeconds, downloadLimit)
                            } else {
                                await onSetFolderSharing(shareItem, true)
                            }
                        }}
                        onDisableShare={async () => {
                            if ('filename' in shareItem) {
                                await onSetFileSharing(shareItem, false)
                            } else {
                                await onSetFolderSharing(shareItem, false)
                            }
                        }}
                    />
                </Suspense>
            )}
        </>
    )
}
