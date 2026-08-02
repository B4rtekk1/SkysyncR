import { authenticatedFetch, getValidAccessToken } from './auth'
import { apiFetch } from './http'
import type { ReauthenticationPayload } from './users'
import { verifyBlobChecksum, type IntegrityVerificationResult } from './filesIntegrity'
import type {
    File as ApiFile,
    FileAudit,
    FileShare as FileSharePerson,
    FileSharePermission,
    FileVersion,
    Folder as ApiFolder,
    FolderGroupShare,
    FolderGroupShareEvent,
    FolderGroupSharePermission,
    FolderPointRestoreResult,
    PublicFolderShareAccess,
    PublicFileShareAccess,
    ShareRecipient as FileShareRecipient,
    SharedFile,
    StorageQuota,
} from './generated'
import {
    ApiResponseValidationError,
    file,
    fileActivity,
    fileShare,
    fileShares,
    fileVersions,
    files,
    folder,
    folderGroupShare,
    folderGroupShareEvents,
    folderGroupShares,
    folderPointRestoreResult,
    folders,
    parseApiErrorBody,
    publicFolderShareAccessEvents,
    publicFileShareAccessEvents,
    readJson,
    shareRecipient,
    sharedFiles,
    storageQuota,
} from './validators'

const API_BASE = import.meta.env?.VITE_API_BASE ?? 'http://localhost:3000/'
const DOWNLOAD_CHECKSUM_HEADER = 'x-skysync-sha256'

async function parseErrorMessage(response: Response): Promise<string> {
    try {
        const data: unknown = await response.json();
        return parseApiErrorBody(data) ?? 'An error occurred';
    } catch {
        return 'An error occurred';
    }
}

export class FileContentConflictError extends Error {
    latestFile: ApiFile | null
    latestText: string | null

    constructor(message: string, latest?: { file: ApiFile; text: string }) {
        super(message)
        this.name = 'FileContentConflictError'
        this.latestFile = latest?.file ?? null
        this.latestText = latest?.text ?? null
    }
}

export type {
    ApiFile,
    ApiFolder,
    FileAudit,
    FileSharePermission,
    FileSharePerson,
    FileShareRecipient,
    FileVersion,
    FolderGroupShare,
    FolderGroupShareEvent,
    FolderGroupSharePermission,
    FolderPointRestoreResult,
    PublicFolderShareAccess,
    PublicFileShareAccess,
    SharedFile,
    StorageQuota,
}
export { verifyBlobChecksum, type IntegrityVerificationResult } from './filesIntegrity'

export type ListPage<T> = {
    items: T[]
    next_cursor: string | null
}

export type ListFilesPageParams = {
    folderId?: string | null | undefined
    tagId?: string | null | undefined
    trashed?: boolean
    limit?: number
    cursor?: string | null | undefined
    search?: string
}

export type ListFoldersPageParams = {
    parentFolderId?: string | null | undefined
    favourite?: boolean
    trashed?: boolean
    limit?: number
    cursor?: string | null | undefined
    search?: string
}

const LIST_PAGE_SIZE = 200

export async function listFilesPage(params: ListFilesPageParams = {}): Promise<ListPage<ApiFile>> {
    const query = new URLSearchParams()
    query.set('limit', String(params.limit ?? LIST_PAGE_SIZE))
    if (params.folderId === null) query.set('folder_id', 'root')
    else if (params.folderId) query.set('folder_id', params.folderId)
    if (params.tagId) query.set('tag_id', params.tagId)
    if (params.trashed) query.set('trashed', 'true')
    if (params.cursor) query.set('cursor', params.cursor)
    if (params.search?.trim()) query.set('search', params.search.trim())

    const res = await authenticatedFetch(`${API_BASE}files?${query.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!res.ok) {
        const message = await parseErrorMessage(res);
        throw new Error(message);
    }

    return readJson(res, fileListPage, 'FileListPage');
}

export async function listFiles(folderId?: string | null): Promise<ApiFile[]> {
    return collectPages((cursor) => listFilesPage({ folderId, cursor }))
}

export async function listTrash(): Promise<ApiFile[]> {
    return collectPages((cursor) => listFilesPage({ trashed: true, cursor }))
}

export async function listSharedFilesWithMe(): Promise<SharedFile[]> {
    const res = await authenticatedFetch(`${API_BASE}files/shared-with-me`, {
        method: 'GET',
    })
    if (!res.ok) {
        const message = await parseErrorMessage(res);
        throw new Error(message);
    }
    return readJson(res, sharedFiles, 'SharedFile[]');
}

export async function getFileShareRecipient(fileId: string, email: string): Promise<FileShareRecipient> {
    const res = await authenticatedFetch(
        `${API_BASE}files/${fileId}/shares/recipient?email=${encodeURIComponent(email)}`,
        { method: 'GET' },
    )
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, shareRecipient, 'ShareRecipient')
}

export async function listFileShares(fileId: string): Promise<FileSharePerson[]> {
    const res = await authenticatedFetch(`${API_BASE}files/${fileId}/shares`, { method: 'GET' })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, fileShares, 'FileShare[]')
}

export async function getFolderShareRecipient(folderId: string, email: string): Promise<FileShareRecipient> {
    const res = await authenticatedFetch(
        `${API_BASE}folders/${folderId}/shares/recipient?email=${encodeURIComponent(email)}`,
        { method: 'GET' },
    )
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, shareRecipient, 'ShareRecipient')
}

export async function listFolderShares(folderId: string): Promise<FileSharePerson[]> {
    const res = await authenticatedFetch(`${API_BASE}folders/${folderId}/shares`, { method: 'GET' })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, fileShares, 'FolderShare[]')
}

export async function createFolderShare(params: {
    folderId: string
    email: string
    permission: FileSharePermission
    encryptedKey: ArrayBuffer | Uint8Array
}): Promise<FileSharePerson> {
    const res = await authenticatedFetch(`${API_BASE}folders/${params.folderId}/shares`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email: params.email,
            permission: params.permission,
            encrypted_key: arrayBufferToBase64(params.encryptedKey),
        }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, fileShare, 'FolderShare')
}

export async function deleteFolderShare(folderId: string, shareId: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}folders/${folderId}/shares/${shareId}`, {
        method: 'DELETE',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function listFolderGroupShares(folderId: string): Promise<FolderGroupShare[]> {
    const res = await authenticatedFetch(`${API_BASE}folders/${folderId}/group-shares`, { method: 'GET' })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, folderGroupShares, 'FolderGroupShare[]')
}

export async function createFolderGroupShare(params: {
    folderId: string
    groupId: string
    permission: FolderGroupSharePermission
}): Promise<FolderGroupShare> {
    const res = await authenticatedFetch(`${API_BASE}folders/${params.folderId}/group-shares`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            group_id: params.groupId,
            permission: params.permission,
        }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, folderGroupShare, 'FolderGroupShare')
}

export async function updateFolderGroupShare(params: {
    folderId: string
    shareId: string
    permission: FolderGroupSharePermission
}): Promise<FolderGroupShare> {
    const res = await authenticatedFetch(`${API_BASE}folders/${params.folderId}/group-shares/${params.shareId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            permission: params.permission,
        }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, folderGroupShare, 'FolderGroupShare')
}

export async function deleteFolderGroupShare(folderId: string, shareId: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}folders/${folderId}/group-shares/${shareId}`, {
        method: 'DELETE',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function listFolderGroupShareEvents(folderId: string): Promise<FolderGroupShareEvent[]> {
    const res = await authenticatedFetch(`${API_BASE}folders/${folderId}/group-shares/activity`, { method: 'GET' })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, folderGroupShareEvents, 'FolderGroupShareEvent[]')
}

export async function createFileShare(params: {
    fileId: string
    email: string
    permission: FileSharePermission
    encryptedKey: ArrayBuffer | Uint8Array
}): Promise<FileSharePerson> {
    const res = await authenticatedFetch(`${API_BASE}files/${params.fileId}/shares`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email: params.email,
            permission: params.permission,
            encrypted_key: arrayBufferToBase64(params.encryptedKey),
        }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, fileShare, 'FileShare')
}

export async function deleteFileShare(fileId: string, shareId: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}files/${fileId}/shares/${shareId}`, {
        method: 'DELETE',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function listFoldersPage(pageParams: ListFoldersPageParams = {}): Promise<ListPage<ApiFolder>> {
    const params = new URLSearchParams()
    params.set('limit', String(pageParams.limit ?? LIST_PAGE_SIZE))
    if (pageParams.parentFolderId) params.set('parent_folder_id', pageParams.parentFolderId)
    if (pageParams.favourite) params.set('favourite', 'true')
    if (pageParams.trashed) params.set('trashed', 'true')
    if (pageParams.cursor) params.set('cursor', pageParams.cursor)
    if (pageParams.search?.trim()) params.set('search', pageParams.search.trim())
    const res = await authenticatedFetch(`${API_BASE}folders?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!res.ok) {
        const message = await parseErrorMessage(res);
        throw new Error(message);
    }

    return readJson(res, folderListPage, 'FolderListPage');
}

export async function listFolders(parentFolderId?: string, favourite = false, trashed = false): Promise<ApiFolder[]> {
    return collectPages((cursor) => listFoldersPage({ parentFolderId, favourite, trashed, cursor }))
}

export async function deleteFolder(id: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}folders/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function restoreFolder(id: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}folders/${id}/restore`, { method: 'POST' })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function createFolder(params: {
    name: string
    description?: string | null
    wrappedKey: ArrayBuffer
    parentFolderId?: string | null
}): Promise<ApiFolder> {
    const res = await authenticatedFetch(`${API_BASE}folders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: params.name,
            description: params.description ?? null,
            encrypted_key: arrayBufferToBase64(params.wrappedKey),
            parent_folder_id: params.parentFolderId ?? null,
        }),
    });

    if (!res.ok) {
        const message = await parseErrorMessage(res);
        throw new Error(message);
    }

    return readJson(res, folder, 'Folder');
}

export async function getStorageQuota(): Promise<StorageQuota> {
    const res = await authenticatedFetch(`${API_BASE}storage/quota`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!res.ok) {
        const message = await parseErrorMessage(res);
        throw new Error(message);
    }

    return readJson(res, storageQuota, 'StorageQuota');
}

export async function uploadFile(params: {
    encryptedFile: Blob | ReadableStream<Uint8Array>
    storedFilename: string
    storedMimeType: string | null
    folderId?: string
    wrappedKey: ArrayBuffer
    encryptionNonce: ArrayBuffer | Uint8Array
    contentKeyFingerprint?: string
    signal?: AbortSignal
}): Promise<ApiFile> {
    const res = await authenticatedMultipartStream(`${API_BASE}files`, [
        textPart('filename', params.storedFilename),
        ...(params.storedMimeType ? [textPart('mime_type', params.storedMimeType)] : []),
        ...(params.folderId ? [textPart('folder_id', params.folderId)] : []),
        textPart('encrypted_key', arrayBufferToBase64(params.wrappedKey)),
        textPart('encryption_nonce', arrayBufferToBase64(params.encryptionNonce)),
        ...(params.contentKeyFingerprint ? [textPart('content_key_fingerprint', params.contentKeyFingerprint)] : []),
        streamPart('file', params.encryptedFile, 'encrypted.bin', 'application/octet-stream'),
    ], 'POST', params.signal)
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, file, 'File')
}

export type UploadSessionStatus = {
    upload_id: string
    offset: number
}

export async function startResumableUpload(uploadId: string): Promise<UploadSessionStatus> {
    const res = await authenticatedRequest(`${API_BASE}files/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_id: uploadId }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return res.json()
}

export async function getResumableUploadStatus(uploadId: string): Promise<UploadSessionStatus> {
    const res = await authenticatedRequest(`${API_BASE}files/uploads/${encodeURIComponent(uploadId)}`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return res.json()
}

export async function appendResumableUploadChunk(params: {
    uploadId: string
    offset: number
    chunk: Blob | Uint8Array
    signal?: AbortSignal
}): Promise<UploadSessionStatus> {
    const init: RequestInit = {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/octet-stream',
            'Upload-Offset': String(params.offset),
        },
        body: params.chunk instanceof Blob
            ? params.chunk
            : new Blob([params.chunk.slice().buffer], { type: 'application/octet-stream' }),
    }
    if (params.signal) init.signal = params.signal

    const res = await authenticatedRequest(`${API_BASE}files/uploads/${encodeURIComponent(params.uploadId)}`, init)
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return res.json()
}

export async function completeResumableUpload(params: {
    uploadId: string
    storedFilename: string
    storedMimeType: string | null
    folderId?: string | null
    wrappedKey: ArrayBuffer | Uint8Array | string
    encryptionNonce: ArrayBuffer | Uint8Array
    contentKeyFingerprint?: string
    sizeBytes: number
    signal?: AbortSignal
}): Promise<ApiFile> {
    const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filename: params.storedFilename,
            mime_type: params.storedMimeType,
            folder_id: params.folderId ?? null,
            encrypted_key: typeof params.wrappedKey === 'string' ? params.wrappedKey : arrayBufferToBase64(params.wrappedKey),
            encryption_nonce: arrayBufferToBase64(params.encryptionNonce),
            content_key_fingerprint: params.contentKeyFingerprint ?? null,
            size_bytes: params.sizeBytes,
        }),
    }
    if (params.signal) init.signal = params.signal

    const res = await authenticatedRequest(`${API_BASE}files/uploads/${encodeURIComponent(params.uploadId)}`, init)
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, file, 'File')
}

export async function cancelResumableUpload(uploadId: string): Promise<void> {
    const res = await authenticatedRequest(`${API_BASE}files/uploads/${encodeURIComponent(uploadId)}`, {
        method: 'DELETE',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function softDeleteFile(id: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}`, {
        method: 'DELETE',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function restoreFile(id: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}/restore`, {
        method: 'POST',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function listFileVersions(id: string): Promise<FileVersion[]> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}/versions`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, fileVersions, 'FileVersion[]')
}

export async function restoreFileVersion(id: string, versionId: string): Promise<ApiFile> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}/versions/${versionId}/restore`, {
        method: 'POST',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, file, 'File')
}

export async function listFileActivity(id: string): Promise<FileAudit[]> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}/activity`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, fileActivity, 'FileAudit[]')
}

export async function permanentlyDeleteFile(id: string, reauth: ReauthenticationPayload): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}/permanent`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reauth),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function permanentlyDeleteFolder(id: string, reauth: ReauthenticationPayload): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}folders/${id}/permanent`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reauth),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function renameFile(id: string, filename: string): Promise<ApiFile> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, file, 'File')
}

export async function renameFolder(id: string, name: string, description?: string | null): Promise<ApiFolder> {
    const res = await authenticatedFetch(`${API_BASE}folders/${id}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description: description ?? null }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, folder, 'Folder')
}

export async function moveFile(id: string, folderId: string | null): Promise<ApiFile> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}/move`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ folder_id: folderId }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, file, 'File')
}

export async function moveFolder(id: string, parentFolderId: string | null): Promise<ApiFolder> {
    const res = await authenticatedFetch(`${API_BASE}folders/${id}/move`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parent_folder_id: parentFolderId }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, folder, 'Folder')
}

export async function restoreFolderPoint(id: string, restoreAt: string): Promise<FolderPointRestoreResult> {
    const res = await authenticatedFetch(`${API_BASE}folders/${id}/restore-point`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ restore_at: restoreAt }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, folderPointRestoreResult, 'FolderPointRestoreResult')
}

export async function updateFileContent(params: {
    id: string
    encryptedFile: Blob | ReadableStream<Uint8Array>
    originalFilename: string
    wrappedKey: ArrayBuffer | Uint8Array | string
    encryptionNonce: ArrayBuffer | Uint8Array
    contentKeyFingerprint: string
    baseUpdatedAt?: string
    force?: boolean
    shareKeys?: Array<{ shareId: string; encryptedKey: ArrayBuffer | Uint8Array | string }>
}): Promise<ApiFile> {
    const res = await authenticatedMultipartStream(`${API_BASE}files/${params.id}/content`, [
        textPart('encrypted_key', typeof params.wrappedKey === 'string' ? params.wrappedKey : arrayBufferToBase64(params.wrappedKey)),
        textPart('encryption_nonce', arrayBufferToBase64(params.encryptionNonce)),
        textPart('content_key_fingerprint', params.contentKeyFingerprint),
        ...(params.baseUpdatedAt ? [textPart('base_updated_at', params.baseUpdatedAt)] : []),
        ...(params.force ? [textPart('force', 'true')] : []),
        textPart('share_keys', JSON.stringify((params.shareKeys ?? []).map((shareKey) => ({
            share_id: shareKey.shareId,
            encrypted_key: typeof shareKey.encryptedKey === 'string'
                ? shareKey.encryptedKey
                : arrayBufferToBase64(shareKey.encryptedKey),
        })))),
        streamPart('file', params.encryptedFile, params.originalFilename, 'application/octet-stream'),
    ], 'PUT')
    if (res.status === 409) throw new FileContentConflictError(await parseErrorMessage(res))
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, file, 'File')
}

export async function shareFile(
    id: string,
    isPublic: boolean,
    expiresInSeconds?: number | null,
    downloadLimit?: number | null,
    password?: string | null,
    recipientEmail?: string | null,
    startsAt?: string | null,
    expiresAt?: string | null,
    oneTime?: boolean,
): Promise<ApiFile> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}/share`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            is_public: isPublic,
            starts_at: startsAt ?? null,
            expires_at: expiresAt ?? null,
            expires_in_seconds: expiresInSeconds ?? null,
            download_limit: downloadLimit ?? null,
            one_time: oneTime ?? false,
            password: password ?? null,
            recipient_email: recipientEmail ?? null,
        }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, file, 'File')
}

export async function listPublicFileShareAccess(fileId: string): Promise<PublicFileShareAccess[]> {
    const res = await authenticatedFetch(`${API_BASE}files/${fileId}/share/access`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, publicFileShareAccessEvents, 'PublicFileShareAccess[]')
}

export async function listPublicFolderShareAccess(folderId: string): Promise<PublicFolderShareAccess[]> {
    const res = await authenticatedFetch(`${API_BASE}folders/${folderId}/share/access`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, publicFolderShareAccessEvents, 'PublicFolderShareAccess[]')
}

export async function expirePublicFileLinks(fileId: string): Promise<ApiFile> {
    const res = await authenticatedFetch(`${API_BASE}files/${fileId}/share/expire`, {
        method: 'POST',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, file, 'File')
}

export async function setFileFavourite(id: string, isFavourite: boolean): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}/favorite`, {
        method: isFavourite ? 'PUT' : 'DELETE',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function setFolderFavourite(id: string, isFavourite: boolean): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}folders/${id}/favorite`, {
        method: isFavourite ? 'PUT' : 'DELETE',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function shareFolder(
    id: string,
    isPublic: boolean,
    expiresInSeconds?: number | null,
    downloadLimit?: number | null,
    password?: string | null,
    recipientEmail?: string | null,
    startsAt?: string | null,
    expiresAt?: string | null,
    oneTime?: boolean,
): Promise<ApiFolder> {
    const res = await authenticatedFetch(`${API_BASE}folders/${id}/share`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            is_public: isPublic,
            starts_at: startsAt ?? null,
            expires_at: expiresAt ?? null,
            expires_in_seconds: expiresInSeconds ?? null,
            download_limit: downloadLimit ?? null,
            one_time: oneTime ?? false,
            password: password ?? null,
            recipient_email: recipientEmail ?? null,
        }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, folder, 'Folder')
}

export async function updateFileNote(id: string, note: string): Promise<ApiFile> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}/note`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ note }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, file, 'File')
}

export async function downloadFile(id: string): Promise<Blob> {
    const res = await authenticatedRequest(`${API_BASE}files/${id}/download`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return (await readVerifiedDownload(res)).blob
}

export type VerifiedDownload = {
    blob: Blob
    checksum: string | null
    integrity: IntegrityVerificationResult
}

export async function downloadFileWithIntegrity(id: string): Promise<VerifiedDownload> {
    const res = await authenticatedRequest(`${API_BASE}files/${id}/download`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readVerifiedDownload(res)
}

export type PublicDownload = {
    blob: Blob
    filename: string
    mimeType: string | null
    encryptionNonce: string | null
    checksum: string | null
    integrity: IntegrityVerificationResult
}

export type PublicFolderManifest = {
    root: ApiFolder
    folders: ApiFolder[]
    files: ApiFile[]
}

function publicFolderManifest(value: unknown, path: string): PublicFolderManifest {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${path}: expected object`)
    }
    const item = value as Record<string, unknown>
    return {
        root: folder(item.root, `${path}.root`),
        folders: folders(item.folders, `${path}.folders`),
        files: files(item.files, `${path}.files`),
    }
}

export type PublicFileAccessDetails = {
    password?: string | null
    recipientEmail?: string | null
}

export async function downloadPublicFile(
    shareToken: string,
    accessDetails: PublicFileAccessDetails = {},
): Promise<PublicDownload> {
    const hasAccessDetails = Boolean(accessDetails.password || accessDetails.recipientEmail)
    const res = await apiFetch(`${API_BASE}share/${encodeURIComponent(shareToken)}/download`, {
        method: hasAccessDetails ? 'POST' : 'GET',
        ...(hasAccessDetails
            ? {
                  headers: {
                      'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                      password: accessDetails.password ?? null,
                      recipient_email: accessDetails.recipientEmail ?? null,
                  }),
              }
            : {}),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))

    const download = await readVerifiedDownload(res)
    return {
        blob: download.blob,
        filename:
            filenameFromBase64Header(res.headers.get('x-skysync-filename-b64')) ??
            filenameFromContentDisposition(res.headers.get('content-disposition')) ??
            'download.bin',
        mimeType: res.headers.get('x-skysync-mime-type'),
        encryptionNonce: res.headers.get('x-skysync-encryption-nonce'),
        checksum: download.checksum,
        integrity: download.integrity,
    }
}

export async function getPublicFolderManifest(
    shareToken: string,
    accessDetails: PublicFileAccessDetails = {},
): Promise<PublicFolderManifest> {
    const hasAccessDetails = Boolean(accessDetails.password || accessDetails.recipientEmail)
    const res = await apiFetch(`${API_BASE}share/folders/${encodeURIComponent(shareToken)}`, {
        method: hasAccessDetails ? 'POST' : 'GET',
        ...(hasAccessDetails
            ? {
                  headers: {
                      'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                      password: accessDetails.password ?? null,
                      recipient_email: accessDetails.recipientEmail ?? null,
                  }),
              }
            : {}),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, publicFolderManifest, 'PublicFolderManifest')
}

export async function downloadPublicFolderFile(
    shareToken: string,
    fileId: string,
    accessDetails: PublicFileAccessDetails = {},
): Promise<PublicDownload> {
    const hasAccessDetails = Boolean(accessDetails.password || accessDetails.recipientEmail)
    const res = await apiFetch(
        `${API_BASE}share/folders/${encodeURIComponent(shareToken)}/files/${encodeURIComponent(fileId)}/download`,
        {
            method: hasAccessDetails ? 'POST' : 'GET',
            ...(hasAccessDetails
                ? {
                      headers: {
                          'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                          password: accessDetails.password ?? null,
                          recipient_email: accessDetails.recipientEmail ?? null,
                      }),
                  }
                : {}),
        },
    )
    if (!res.ok) throw new Error(await parseErrorMessage(res))

    const download = await readVerifiedDownload(res)
    return {
        blob: download.blob,
        filename:
            filenameFromBase64Header(res.headers.get('x-skysync-filename-b64')) ??
            filenameFromContentDisposition(res.headers.get('content-disposition')) ??
            'download.bin',
        mimeType: res.headers.get('x-skysync-mime-type'),
        encryptionNonce: res.headers.get('x-skysync-encryption-nonce'),
        checksum: download.checksum,
        integrity: download.integrity,
    }
}

async function readVerifiedDownload(res: Response): Promise<VerifiedDownload> {
    const blob = await res.blob()
    const checksum = res.headers.get(DOWNLOAD_CHECKSUM_HEADER)
    return {
        blob,
        checksum,
        integrity: await verifyBlobChecksum(blob, checksum),
    }
}

async function collectPages<T>(loadPage: (cursor: string | null) => Promise<ListPage<T>>): Promise<T[]> {
    const collected: T[] = []
    let cursor: string | null = null

    do {
        const page = await loadPage(cursor)
        collected.push(...page.items)
        cursor = page.next_cursor
    } while (cursor)

    return collected
}

function fileListPage(value: unknown, path: string): ListPage<ApiFile> {
    return listPage(value, path, files)
}

function folderListPage(value: unknown, path: string): ListPage<ApiFolder> {
    return listPage(value, path, folders)
}

function listPage<T>(
    value: unknown,
    path: string,
    itemsValidator: (value: unknown, path: string) => T[],
): ListPage<T> {
    if (Array.isArray(value)) {
        return {
            items: itemsValidator(value, path),
            next_cursor: null,
        }
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ApiResponseValidationError(`${path}: expected object`)
    }
    const item = value as Record<string, unknown>
    const nextCursor = item.next_cursor ?? null
    if (nextCursor !== null && typeof nextCursor !== 'string') {
        throw new ApiResponseValidationError(`${path}.next_cursor: expected string or null`)
    }
    return {
        items: itemsValidator(item.items, `${path}.items`),
        next_cursor: nextCursor,
    }
}

function filenameFromContentDisposition(value: string | null): string | null {
    if (!value) return null
    const match = /filename="([^"]+)"/i.exec(value)
    const filename = match?.[1]?.trim()
    return filename || null
}

function filenameFromBase64Header(value: string | null): string | null {
    if (!value) return null
    try {
        return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0))) || null
    } catch {
        return null
    }
}

function arrayBufferToBase64(buf: ArrayBuffer | Uint8Array): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

type MultipartPart =
    | { kind: 'text'; name: string; value: string }
    | { kind: 'stream'; name: string; value: Blob | ReadableStream<Uint8Array>; filename: string; contentType: string }

function textPart(name: string, value: string): MultipartPart {
    return { kind: 'text', name, value }
}

function streamPart(
    name: string,
    value: Blob | ReadableStream<Uint8Array>,
    filename: string,
    contentType: string,
): MultipartPart {
    return { kind: 'stream', name, value, filename, contentType }
}

async function authenticatedRequest(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    const token = await getValidAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return apiFetch(input, { ...init, headers })
}

async function authenticatedMultipartStream(
    url: string,
    parts: MultipartPart[],
    method = 'POST',
    signal?: AbortSignal,
): Promise<Response> {
    const body = new FormData()

    for (const part of parts) {
        signal?.throwIfAborted()

        if (part.kind === 'text') {
            body.append(part.name, part.value)
            continue
        }

        body.append(
            part.name,
            await multipartBlob(part.value, part.contentType, signal),
            part.filename,
        )
    }

    return authenticatedRequest(url, signal ? { method, body, signal } : { method, body })
}

async function multipartBlob(
    value: Blob | ReadableStream<Uint8Array>,
    contentType: string,
    signal?: AbortSignal,
): Promise<Blob> {
    signal?.throwIfAborted()

    if (value instanceof Blob) {
        return value.type === contentType ? value : value.slice(0, value.size, contentType)
    }

    const buffer = await new Response(value).arrayBuffer()
    signal?.throwIfAborted()
    return new Blob([buffer], { type: contentType })
}
