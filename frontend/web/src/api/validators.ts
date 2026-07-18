import type {
  CalendarEntry,
  CurrentUser,
  File,
  FileAudit,
  FileShare,
  FileSharePermission,
  FileVersion,
  Folder,
  Group,
  GroupInvite,
  GroupRole,
  GroupShareRecipient,
  RegisterResponse,
  RecoveryBlob,
  ShareRecipient,
  SharedFile,
  StorageQuota,
  TokenPair,
  UserSettings,
} from './generated'

type Validator<T> = (value: unknown, path: string) => T
type JsonRecord = Record<string, unknown>

export class ApiResponseValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiResponseValidationError'
  }
}

export async function readJson<T>(
  response: Response,
  validator: Validator<T>,
  label: string,
): Promise<T> {
  const value: unknown = await response.json()
  try {
    return validator(value, label)
  } catch (err) {
    if (err instanceof ApiResponseValidationError) {
      throw err
    }
    throw new ApiResponseValidationError(`${label}: invalid API response`)
  }
}

export function parseApiErrorBody(value: unknown): string | null {
  if (!isRecord(value)) return null

  const message = value.message
  if (typeof message === 'string' && message.trim()) return message

  const error = value.error
  if (typeof error === 'string' && error.trim()) return error

  return null
}

function invalid(path: string, expected: string): never {
  throw new ApiResponseValidationError(`${path}: expected ${expected}`)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function object(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) invalid(path, 'object')
  return value
}

function prop(source: JsonRecord, key: string, path: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    invalid(`${path}.${key}`, 'present property')
  }
  return source[key]
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path, 'string')
  return value
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null
  return string(value, path)
}

function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, 'finite number')
  return value
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'boolean')
  return value
}

function nullableNumber(value: unknown, path: string): number | null {
  if (value === null) return null
  return number(value, path)
}

function arrayOf<T>(itemValidator: Validator<T>): Validator<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) invalid(path, 'array')
    return value.map((item, index) => itemValidator(item, `${path}[${index}]`))
  }
}

function oneOf<const T extends readonly string[]>(
  allowed: T,
): Validator<T[number]> {
  return (value, path) => {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      invalid(path, allowed.join(' | '))
    }
    return value
  }
}

const fileSharePermission = oneOf(['read', 'download', 'write'] as const)
const groupRole = oneOf(['viewer', 'editor', 'admin'] as const)
const calendarKind = oneOf(['event', 'deadline'] as const)

export const tokenPair: Validator<TokenPair> = (value, path) => {
  const item = object(value, path)
  return {
    access_token: string(prop(item, 'access_token', path), `${path}.access_token`),
    expires_in: number(prop(item, 'expires_in', path), `${path}.expires_in`),
  }
}

export const registerResponse: Validator<RegisterResponse> = (value, path) => {
  const item = object(value, path)
  return {
    id: string(prop(item, 'id', path), `${path}.id`),
  }
}

export const recoveryBlob: Validator<RecoveryBlob> = (value, path) => {
  const item = object(value, path)
  return {
    user_id: string(prop(item, 'user_id', path), `${path}.user_id`),
    encrypted_private_key_recovery: string(
      prop(item, 'encrypted_private_key_recovery', path),
      `${path}.encrypted_private_key_recovery`,
    ),
  }
}

export const currentUser: Validator<CurrentUser> = (value, path) => {
  const item = object(value, path)
  return {
    id: string(prop(item, 'id', path), `${path}.id`),
    email: string(prop(item, 'email', path), `${path}.email`),
    display_name: nullableString(prop(item, 'display_name', path), `${path}.display_name`),
    avatar_url: nullableString(prop(item, 'avatar_url', path), `${path}.avatar_url`),
    public_key: nullableString(prop(item, 'public_key', path), `${path}.public_key`),
    default_view: string(prop(item, 'default_view', path), `${path}.default_view`),
    layout_mode: string(prop(item, 'layout_mode', path), `${path}.layout_mode`),
    upload_protection: boolean(prop(item, 'upload_protection', path), `${path}.upload_protection`),
    compact_metadata: boolean(prop(item, 'compact_metadata', path), `${path}.compact_metadata`),
    device_lock: boolean(prop(item, 'device_lock', path), `${path}.device_lock`),
    sync_on_metered: boolean(prop(item, 'sync_on_metered', path), `${path}.sync_on_metered`),
    trash_retention_days: number(prop(item, 'trash_retention_days', path), `${path}.trash_retention_days`),
  }
}

export const userSettings: Validator<UserSettings> = (value, path) => {
  const item = object(value, path)
  return {
    display_name: nullableString(prop(item, 'display_name', path), `${path}.display_name`),
    avatar_url: nullableString(prop(item, 'avatar_url', path), `${path}.avatar_url`),
    default_view: string(prop(item, 'default_view', path), `${path}.default_view`),
    layout_mode: string(prop(item, 'layout_mode', path), `${path}.layout_mode`),
    upload_protection: boolean(prop(item, 'upload_protection', path), `${path}.upload_protection`),
    compact_metadata: boolean(prop(item, 'compact_metadata', path), `${path}.compact_metadata`),
    device_lock: boolean(prop(item, 'device_lock', path), `${path}.device_lock`),
    sync_on_metered: boolean(prop(item, 'sync_on_metered', path), `${path}.sync_on_metered`),
    trash_retention_days: number(prop(item, 'trash_retention_days', path), `${path}.trash_retention_days`),
  }
}

export const file: Validator<File> = (value, path) => {
  const item = object(value, path)
  return {
    id: string(prop(item, 'id', path), `${path}.id`),
    filename: string(prop(item, 'filename', path), `${path}.filename`),
    storage_path: string(prop(item, 'storage_path', path), `${path}.storage_path`),
    mime_type: nullableString(prop(item, 'mime_type', path), `${path}.mime_type`),
    size_bytes: number(prop(item, 'size_bytes', path), `${path}.size_bytes`),
    folder_id: nullableString(prop(item, 'folder_id', path), `${path}.folder_id`),
    note: nullableString(prop(item, 'note', path), `${path}.note`),
    is_deleted: boolean(prop(item, 'is_deleted', path), `${path}.is_deleted`),
    is_public: boolean(prop(item, 'is_public', path), `${path}.is_public`),
    share_token: nullableString(prop(item, 'share_token', path), `${path}.share_token`),
    share_expires_at: nullableString(prop(item, 'share_expires_at', path), `${path}.share_expires_at`),
    share_download_limit: nullableNumber(prop(item, 'share_download_limit', path), `${path}.share_download_limit`),
    share_download_count: number(prop(item, 'share_download_count', path), `${path}.share_download_count`),
    is_favourite: boolean(prop(item, 'is_favourite', path), `${path}.is_favourite`),
    encrypted_key: string(prop(item, 'encrypted_key', path), `${path}.encrypted_key`),
    encryption_nonce: string(prop(item, 'encryption_nonce', path), `${path}.encryption_nonce`),
    created_at: string(prop(item, 'created_at', path), `${path}.created_at`),
    updated_at: string(prop(item, 'updated_at', path), `${path}.updated_at`),
    deleted_at: nullableString(prop(item, 'deleted_at', path), `${path}.deleted_at`),
  }
}

export const sharedFile: Validator<SharedFile> = (value, path) => {
  const base = file(value, path)
  const item = object(value, path)
  return {
    ...base,
    permissions: fileSharePermission(prop(item, 'permissions', path), `${path}.permissions`),
    shared_by_user_id: string(prop(item, 'shared_by_user_id', path), `${path}.shared_by_user_id`),
    shared_by_user_name: nullableString(prop(item, 'shared_by_user_name', path), `${path}.shared_by_user_name`),
  }
}

export const shareRecipient: Validator<ShareRecipient> = (value, path) => {
  const item = object(value, path)
  return {
    email: string(prop(item, 'email', path), `${path}.email`),
    public_key: string(prop(item, 'public_key', path), `${path}.public_key`),
  }
}

export const fileShare: Validator<FileShare> = (value, path) => {
  const item = object(value, path)
  return {
    id: string(prop(item, 'id', path), `${path}.id`),
    email: string(prop(item, 'email', path), `${path}.email`),
    display_name: nullableString(prop(item, 'display_name', path), `${path}.display_name`),
    permission: fileSharePermission(prop(item, 'permission', path), `${path}.permission`) as FileSharePermission,
    created_at: string(prop(item, 'created_at', path), `${path}.created_at`),
  }
}

export const fileVersion: Validator<FileVersion> = (value, path) => {
  const item = object(value, path)
  return {
    id: string(prop(item, 'id', path), `${path}.id`),
    file_id: string(prop(item, 'file_id', path), `${path}.file_id`),
    version_number: number(prop(item, 'version_number', path), `${path}.version_number`),
    size_bytes: number(prop(item, 'size_bytes', path), `${path}.size_bytes`),
    checksum: nullableString(prop(item, 'checksum', path), `${path}.checksum`),
    device_label: nullableString(prop(item, 'device_label', path), `${path}.device_label`),
    action: string(prop(item, 'action', path), `${path}.action`),
    created_at: string(prop(item, 'created_at', path), `${path}.created_at`),
  }
}

export const fileAudit: Validator<FileAudit> = (value, path) => {
  const item = object(value, path)
  return {
    id: string(prop(item, 'id', path), `${path}.id`),
    action: string(prop(item, 'action', path), `${path}.action`),
    resource_id: nullableString(prop(item, 'resource_id', path), `${path}.resource_id`),
    resource_type: nullableString(prop(item, 'resource_type', path), `${path}.resource_type`),
    device_label: nullableString(prop(item, 'device_label', path), `${path}.device_label`),
    created_at: string(prop(item, 'created_at', path), `${path}.created_at`),
  }
}

export const folder: Validator<Folder> = (value, path) => {
  const item = object(value, path)
  return {
    id: string(prop(item, 'id', path), `${path}.id`),
    name: string(prop(item, 'name', path), `${path}.name`),
    description: nullableString(prop(item, 'description', path), `${path}.description`),
    parent_folder_id: nullableString(prop(item, 'parent_folder_id', path), `${path}.parent_folder_id`),
    encrypted_key: nullableString(prop(item, 'encrypted_key', path), `${path}.encrypted_key`),
    is_public: boolean(prop(item, 'is_public', path), `${path}.is_public`),
    share_token: nullableString(prop(item, 'share_token', path), `${path}.share_token`),
    created_at: string(prop(item, 'created_at', path), `${path}.created_at`),
    updated_at: string(prop(item, 'updated_at', path), `${path}.updated_at`),
    is_deleted: boolean(prop(item, 'is_deleted', path), `${path}.is_deleted`),
    deleted_at: nullableString(prop(item, 'deleted_at', path), `${path}.deleted_at`),
    file_count: number(prop(item, 'file_count', path), `${path}.file_count`),
    is_favourite: boolean(prop(item, 'is_favourite', path), `${path}.is_favourite`),
  }
}

export const storageQuota: Validator<StorageQuota> = (value, path) => {
  const item = object(value, path)
  return {
    total_bytes: number(prop(item, 'total_bytes', path), `${path}.total_bytes`),
    used_bytes: number(prop(item, 'used_bytes', path), `${path}.used_bytes`),
  }
}

export const groupInvite: Validator<GroupInvite> = (value, path) => {
  const item = object(value, path)
  return {
    id: string(prop(item, 'id', path), `${path}.id`),
    email: string(prop(item, 'email', path), `${path}.email`),
    role: groupRole(prop(item, 'role', path), `${path}.role`) as GroupRole,
    createdAt: string(prop(item, 'createdAt', path), `${path}.createdAt`),
  }
}

export const group: Validator<Group> = (value, path) => {
  const item = object(value, path)
  return {
    id: string(prop(item, 'id', path), `${path}.id`),
    name: string(prop(item, 'name', path), `${path}.name`),
    defaultRole: groupRole(prop(item, 'defaultRole', path), `${path}.defaultRole`) as GroupRole,
    createdAt: string(prop(item, 'createdAt', path), `${path}.createdAt`),
    invites: arrayOf(groupInvite)(prop(item, 'invites', path), `${path}.invites`),
  }
}

export const groupShareRecipient: Validator<GroupShareRecipient> = (value, path) => {
  const item = object(value, path)
  return {
    email: string(prop(item, 'email', path), `${path}.email`),
    public_key: string(prop(item, 'public_key', path), `${path}.public_key`),
    role: groupRole(prop(item, 'role', path), `${path}.role`) as GroupRole,
  }
}

export const calendarEntry: Validator<CalendarEntry> = (value, path) => {
  const item = object(value, path)
  return {
    id: string(prop(item, 'id', path), `${path}.id`),
    kind: calendarKind(prop(item, 'kind', path), `${path}.kind`),
    date: string(prop(item, 'date', path), `${path}.date`),
    time: string(prop(item, 'time', path), `${path}.time`),
    title: string(prop(item, 'title', path), `${path}.title`),
    note: string(prop(item, 'note', path), `${path}.note`),
    reminder: string(prop(item, 'reminder', path), `${path}.reminder`),
    file_id: nullableString(prop(item, 'file_id', path), `${path}.file_id`),
    created_at: string(prop(item, 'created_at', path), `${path}.created_at`),
    updated_at: string(prop(item, 'updated_at', path), `${path}.updated_at`),
  }
}

export const files = arrayOf(file)
export const sharedFiles = arrayOf(sharedFile)
export const fileShares = arrayOf(fileShare)
export const fileVersions = arrayOf(fileVersion)
export const fileActivity = arrayOf(fileAudit)
export const folders = arrayOf(folder)
export const groups = arrayOf(group)
export const groupShareRecipients = arrayOf(groupShareRecipient)
export const calendarEntries = arrayOf(calendarEntry)
