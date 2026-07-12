import type { ApiFile, SharedFile } from '../../api/files'
export type ViewKey = 'all' | 'favourites' | 'shared' | 'groups' | 'trash'
export type LayoutMode = 'grid' | 'list'
export type FileSortKey =
    | 'manual'
    | 'name-asc'
    | 'name-desc'
    | 'updated-desc'
    | 'updated-asc'
    | 'size-desc'
    | 'size-asc'
export type Item = ApiFile | SharedFile
export type FilePreviewKind = 'image' | 'text'
export type FilePreviewState = {
    item: Item
    kind: FilePreviewKind
    url: string | null
    text: string | null
    loading: boolean
}
export type GroupInviteRole = 'viewer' | 'editor' | 'admin'

export type GroupInvite = {
    id: string
    email: string
    role: GroupInviteRole
    createdAt: string
}

export type Group = {
    id: string
    name: string
    defaultRole: GroupInviteRole
    createdAt: string
    invites: GroupInvite[]
}

export type NavIndicator = {
    x: number
    y: number
    width: number
    height: number
    visible: boolean
}


