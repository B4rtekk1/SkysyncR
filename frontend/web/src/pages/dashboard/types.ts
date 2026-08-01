import type { ApiFile, ApiFolder, SharedFile } from '../../api/files'
export type ViewKey = 'recent' | 'all' | 'favourites' | 'shared' | 'groups' | 'calendar' | 'security' | 'trash'
export type LayoutMode = 'grid' | 'list'
export type FileSortKey =
    | 'manual'
    | 'name-asc'
    | 'name-desc'
    | 'updated-desc'
    | 'updated-asc'
    | 'size-desc'
    | 'size-asc'
export type FileTypeFilterKey =
    | 'image'
    | 'document'
    | 'pdf'
    | 'sheet'
    | 'presentation'
    | 'archive'
    | 'video'
    | 'audio'
    | 'text'
    | 'code'
    | 'file'
export type FileVisibilityFilterKey = 'any' | 'public' | 'private'
export type FileOwnerFilterOption = {
    id: string
    label: string
}
export type FileFolderFilterOption = {
    id: string
    label: string
}
export type FileFilters = {
    types: FileTypeFilterKey[]
    visibility: FileVisibilityFilterKey
    ownerId: string
    folderId: string
    tagId: string
    minSizeMb: string
    maxSizeMb: string
    excludedExtensions: string
    modifiedFrom: string
    modifiedTo: string
    noteQuery: string
}
export type Item = ApiFile | SharedFile
export type ShareableItem = Item | ApiFolder
export type FilePreviewKind = 'image' | 'text' | 'video' | 'audio' | 'pdf' | 'presentation' | 'sheet' | 'document'
export type FilePreviewState = {
    item: Item
    kind: FilePreviewKind
    url: string | null
    text: string | null
    loading: boolean
    startEditing?: boolean | undefined
}
export type GroupInviteRole = 'viewer' | 'editor' | 'admin'

export type GroupInvite = {
    id: string
    email: string
    role: GroupInviteRole
    createdAt: string
}

export type GroupMember = {
    userId: string
    email: string
    displayName: string | null
    role: GroupInviteRole
    joinedAt: string
    isOwner: boolean
}

export type GroupIncomingInvite = {
    id: string
    groupId: string
    groupName: string
    invitedByEmail: string
    role: GroupInviteRole
    createdAt: string
    expiresAt: string
}

export type Group = {
    id: string
    name: string
    defaultRole: GroupInviteRole
    createdAt: string
    ownerEmail: string
    ownedByMe: boolean
    myRole: GroupInviteRole
    members: GroupMember[]
    invites: GroupInvite[]
}

export type NavIndicator = {
    x: number
    y: number
    width: number
    height: number
    visible: boolean
}
