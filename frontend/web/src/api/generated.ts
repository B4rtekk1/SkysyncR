// Generated from common/openapi.json. Do not edit by hand.

export type ApiError = {
  "message"?: string
  "error"?: string
}

export type RegisterRequest = {
  "email": string
  "display_name": string
  "password": string
  "public_key": string
}

export type LoginRequest = {
  "email": string
  "password": string
  "remember"?: boolean
}

export type RegisterResponse = {
  "id": string
}

export type TokenPair = {
  "access_token": string
  "expires_in": number
}

export type CurrentUser = {
  "id": string
  "email": string
  "display_name": string | null
  "avatar_url": string | null
  "public_key": string | null
  "default_view": string
  "layout_mode": string
  "upload_protection": boolean
  "compact_metadata": boolean
  "device_lock": boolean
  "sync_on_metered": boolean
  "trash_retention_days": number
}

export type UserSettingsRequest = {
  "display_name"?: string | null
  "avatar_url"?: string | null
  "default_view"?: string
  "layout_mode"?: string
  "upload_protection"?: boolean
  "compact_metadata"?: boolean
  "device_lock"?: boolean
  "sync_on_metered"?: boolean
  "trash_retention_days"?: number
}

export type UserSettings = {
  "display_name": string | null
  "avatar_url": string | null
  "default_view": string
  "layout_mode": string
  "upload_protection": boolean
  "compact_metadata": boolean
  "device_lock": boolean
  "sync_on_metered": boolean
  "trash_retention_days": number
}

export type VerifyUserRequest = {
  "token": string
}

export type FileSharePermission = "read" | "download" | "write"

export type GroupRole = "viewer" | "editor" | "admin"

export type CalendarEntryKind = "event" | "deadline"

export type File = {
  "id": string
  "filename": string
  "storage_path": string
  "mime_type": string | null
  "size_bytes": number
  "folder_id": string | null
  "note": string | null
  "is_deleted": boolean
  "is_public": boolean
  "share_token": string | null
  "share_expires_at": string | null
  "share_download_limit": number | null
  "share_download_count": number
  "is_favourite": boolean
  "encrypted_key": string
  "encryption_nonce": string
  "created_at": string
  "updated_at": string
  "deleted_at": string | null
}

export type SharedFile = File & {
  "permissions": FileSharePermission
  "shared_by_user_id": string
  "shared_by_user_name": string | null
}

export type ShareRecipient = {
  "email": string
  "public_key": string
}

export type FileShare = {
  "id": string
  "email": string
  "display_name": string | null
  "permission": FileSharePermission
  "created_at": string
}

export type Folder = {
  "id": string
  "name": string
  "description": string | null
  "parent_folder_id": string | null
  "encrypted_key": string | null
  "is_public": boolean
  "share_token": string | null
  "created_at": string
  "updated_at": string
  "is_deleted": boolean
  "deleted_at": string | null
  "file_count": number
}

export type StorageQuota = {
  "total_bytes": number
  "used_bytes": number
}

export type GroupInvite = {
  "id": string
  "email": string
  "role": GroupRole
  "createdAt": string
}

export type Group = {
  "id": string
  "name": string
  "defaultRole": GroupRole
  "createdAt": string
  "invites": GroupInvite[]
}

export type GroupShareRecipient = {
  "email": string
  "public_key": string
  "role": GroupRole
}

export type CalendarEntry = {
  "id": string
  "kind": CalendarEntryKind
  "date": string
  "time": string
  "title": string
  "note": string
  "reminder": string
  "file_id": string | null
  "created_at": string
  "updated_at": string
}

export type CalendarEntryRequest = {
  "kind": CalendarEntryKind
  "date": string
  "time": string
  "title": string
  "note": string
  "reminder": string
  "file_id": string | null
}

export type RenameFileRequest = {
  "filename": string
}

export type ShareFileRequest = {
  "is_public": boolean
  "expires_in_seconds"?: number | null
  "download_limit"?: number | null
}

export type UpdateFileNoteRequest = {
  "note": string
}

export type CreateFileShareRequest = {
  "email": string
  "permission": FileSharePermission
  "encrypted_key": string
}

export type CreateFolderRequest = {
  "name": string
  "description"?: string | null
  "parent_folder_id"?: string | null
  "encrypted_key": string
}

export type RenameFolderRequest = {
  "name": string
  "description"?: string | null
}

export type ShareFolderRequest = {
  "is_public": boolean
}

export type GroupRequest = {
  "name": string
  "default_role": GroupRole
}

export type GroupInviteRequest = {
  "email": string
  "role": GroupRole
}

export type FileUploadRequest = {
  "filename": string
  "mime_type"?: string
  "folder_id"?: string
  "encrypted_key": string
  "encryption_nonce": string
  "file": string
}

export type FileContentUpdateRequest = {
  "encrypted_key": string
  "encryption_nonce": string
  "file": string
}

