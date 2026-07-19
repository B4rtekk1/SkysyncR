import type { CurrentUserResponse } from '../../../api/users'
import type { ApiFolder } from '../../../api/files'
import SettingsModal from '../../Settings'
import { CreateFileModal } from './CreateFileModal'
import { CreateFolderModal } from './CreateFolderModal'
import { FileNoteModal } from './FileNoteModal'
import { ImagePreviewModal } from '../previews/ImagePreviewModal'
import { ShareFileModal } from './ShareFileModal'
import { hasFileExtension } from '../createdFile'
import type { FilePreviewState, Group, Item, ShareableItem } from '../types'
import type { SettingsState } from '../../settingsPreferences'

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
    shareItem: ShareableItem | null
    shareLoading: boolean
    privateKey: CryptoKey | null
    groups: Group[]
    onCloseShare: () => void
    onSetFileSharing: (item: Item, isPublic: boolean, expiresInSeconds?: number | null, downloadLimit?: number | null) => Promise<unknown>
    onSetFolderSharing: (folder: ApiFolder, isPublic: boolean) => Promise<unknown>
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
    shareItem,
    shareLoading,
    privateKey,
    groups,
    onCloseShare,
    onSetFileSharing,
    onSetFolderSharing,
}: DashboardModalsProps) {
    return (
        <>
            {filePreview && (
                <ImagePreviewModal
                    key={filePreview.item.id}
                    preview={filePreview}
                    onClose={onCloseFilePreview}
                    onDownload={onDownload}
                    onSaveText={onSaveTextFile}
                />
            )}
            {settingsOpen && (
                <SettingsModal
                    currentUser={currentUser}
                    onClose={onCloseSettings}
                    onSave={onSaveSettings}
                />
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
            {shareItem && (
                <ShareFileModal
                    item={shareItem}
                    itemKind={'filename' in shareItem ? 'file' : 'folder'}
                    shareUrl={
                        shareItem.is_public && shareItem.share_token
                            ? `${window.location.origin}/share/${'filename' in shareItem ? '' : 'folders/'}${shareItem.share_token}`
                            : null
                    }
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
            )}
        </>
    )
}
