type CreateFileModalProps = {
    currentFolderName: string
    fileNameDraft: string
    fileSaving: boolean
    canCreate: boolean
    onFileNameChange: (value: string) => void
    onCreate: () => void
    onClose: () => void
}

export function CreateFileModal({
    currentFolderName,
    fileNameDraft,
    fileSaving,
    canCreate,
    onFileNameChange,
    onCreate,
    onClose,
}: CreateFileModalProps) {
    return (
        <div className="file-filter__modal is-opening" role="dialog" aria-modal="true" aria-labelledby="file-create-title">
            <div className="file-filter__dialog file-create">
                <div className="file-filter__modal-head">
                    <div>
                        <h2 id="file-create-title">New file</h2>
                        <span>{currentFolderName}</span>
                    </div>
                    <button className="file-filter__close" type="button" onClick={onClose} aria-label="Close">
                        x
                    </button>
                </div>
                <div className="file-filter__modal-body file-create__body">
                    <input
                        className="folder-create__input"
                        value={fileNameDraft}
                        onChange={(event) => onFileNameChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') onCreate()
                            if (event.key === 'Escape') onClose()
                        }}
                        placeholder="File name with extension"
                        autoFocus
                    />
                    <p className="file-create__hint">Use an extension like .txt, .md, .json, .html, .css or .js.</p>
                </div>
                <div className="file-filter__footer">
                    <button className="btn btn--ghost" type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button className="btn btn--solid" type="button" disabled={!canCreate || fileSaving} onClick={onCreate}>
                        {fileSaving ? 'Creating...' : 'Create'}
                    </button>
                </div>
            </div>
        </div>
    )
}
