type CreateFolderModalProps = {
    currentFolderName: string
    folderNameDraft: string
    folderDescriptionDraft: string
    folderSaving: boolean
    onFolderNameChange: (value: string) => void
    onFolderDescriptionChange: (value: string) => void
    onCreate: () => void
    onClose: () => void
}

export function CreateFolderModal({
    currentFolderName,
    folderNameDraft,
    folderDescriptionDraft,
    folderSaving,
    onFolderNameChange,
    onFolderDescriptionChange,
    onCreate,
    onClose,
}: CreateFolderModalProps) {
    return (
        <div className="file-filter__modal is-opening" role="dialog" aria-modal="true" aria-labelledby="folder-create-title">
            <div className="file-filter__dialog folder-create">
                <div className="file-filter__modal-head">
                    <div>
                        <h2 id="folder-create-title">New folder</h2>
                        <span>{currentFolderName}</span>
                    </div>
                    <button className="file-filter__close" type="button" onClick={onClose} aria-label="Close">
                        x
                    </button>
                </div>
                <div className="file-filter__modal-body">
                    <input
                        className="folder-create__input"
                        value={folderNameDraft}
                        onChange={(event) => onFolderNameChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') onCreate()
                            if (event.key === 'Escape') onClose()
                        }}
                        placeholder="Folder name"
                        autoFocus
                    />
                    <textarea
                        className="folder-create__input folder-create__textarea"
                        value={folderDescriptionDraft}
                        onChange={(event) => onFolderDescriptionChange(event.target.value)}
                        onKeyDown={(event) => {
                            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') onCreate()
                            if (event.key === 'Escape') onClose()
                        }}
                        placeholder="Folder description"
                        rows={4}
                    />
                </div>
                <div className="file-filter__footer">
                    <button className="btn btn--ghost" type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="btn btn--solid"
                        type="button"
                        disabled={!folderNameDraft.trim() || folderSaving}
                        onClick={onCreate}
                    >
                        {folderSaving ? 'Creating...' : 'Create'}
                    </button>
                </div>
            </div>
        </div>
    )
}
