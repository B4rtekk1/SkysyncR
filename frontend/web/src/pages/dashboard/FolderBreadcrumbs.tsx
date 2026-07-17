import type { ApiFolder } from '../../api/files'

type FolderBreadcrumbsProps = {
    folderTrail: ApiFolder[]
    onOpenRoot: () => void
    onOpenFolderAt: (folder: ApiFolder, index: number) => void
    onOpenParent: () => void
}

export function FolderBreadcrumbs({
    folderTrail,
    onOpenRoot,
    onOpenFolderAt,
    onOpenParent,
}: FolderBreadcrumbsProps) {
    return (
        <div className="folder-path" aria-label="Current folder">
            <button type="button" onClick={onOpenRoot}>
                All files
            </button>
            {folderTrail.map((folder, index) => (
                <span key={folder.id}>
                    <span aria-hidden="true">/</span>
                    <button type="button" onClick={() => onOpenFolderAt(folder, index)}>
                        {folder.name}
                    </button>
                </span>
            ))}
            <button className="folder-path__up" type="button" onClick={onOpenParent}>
                Up
            </button>
        </div>
    )
}
