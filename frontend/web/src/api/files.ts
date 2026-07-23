import { authenticatedFetch, getValidAccessToken } from './auth'
import { apiFetch } from './http'
import type {
    File as ApiFile,
    FileAudit,
    FileShare as FileSharePerson,
    FileSharePermission,
    FileVersion,
    Folder as ApiFolder,
    ShareRecipient as FileShareRecipient,
    SharedFile,
    StorageQuota,
} from './generated'
import {
    file,
    fileActivity,
    fileShare,
    fileShares,
    fileVersions,
    files,
    folder,
    folders,
    parseApiErrorBody,
    readJson,
    shareRecipient,
    sharedFiles,
    storageQuota,
} from './validators'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/'

async function parseErrorMessage(response: Response): Promise<string> {
    try {
        const data: unknown = await response.json();
        return parseApiErrorBody(data) ?? 'An error occurred';
    } catch {
        return 'An error occurred';
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
    SharedFile,
    StorageQuota,
}

export async function listFiles(folderId?: string | null): Promise<ApiFile[]> {
    const qs = folderId === null ? '?folder_id=root' : folderId ? `?folder_id=${encodeURIComponent(folderId)}` : '';
    const res = await authenticatedFetch(`${API_BASE}files${qs}`, {
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

    return readJson(res, files, 'File[]');
}

export async function listTrash(): Promise<ApiFile[]> {
    const res = await authenticatedFetch(`${API_BASE}files?trashed=true`, {
        method: 'GET',
    })
    if (!res.ok) {
        const message = await parseErrorMessage(res);
        throw new Error(message);
    }
    return readJson(res, files, 'File[]');
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

export async function listFolders(parentFolderId?: string, favourite = false): Promise<ApiFolder[]> {
    const params = new URLSearchParams()
    if (parentFolderId) params.set('parent_folder_id', parentFolderId)
    if (favourite) params.set('favourite', 'true')
    const qs = params.toString() ? `?${params.toString()}` : ''
    const res = await authenticatedFetch(`${API_BASE}folders${qs}`, {
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

    return readJson(res, folders, 'Folder[]');
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
    signal?: AbortSignal
}): Promise<ApiFile> {
    const res = await authenticatedMultipartStream(`${API_BASE}files`, [
        textPart('filename', params.storedFilename),
        ...(params.storedMimeType ? [textPart('mime_type', params.storedMimeType)] : []),
        ...(params.folderId ? [textPart('folder_id', params.folderId)] : []),
        textPart('encrypted_key', arrayBufferToBase64(params.wrappedKey)),
        textPart('encryption_nonce', arrayBufferToBase64(params.encryptionNonce)),
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

export async function permanentlyDeleteFile(id: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}/permanent`, {
        method: 'DELETE',
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

export async function updateFileContent(params: {
    id: string
    encryptedFile: Blob | ReadableStream<Uint8Array>
    originalFilename: string
    wrappedKey: ArrayBuffer | Uint8Array | string
    encryptionNonce: ArrayBuffer | Uint8Array
}): Promise<ApiFile> {
    const res = await authenticatedMultipartStream(`${API_BASE}files/${params.id}/content`, [
        textPart('encrypted_key', typeof params.wrappedKey === 'string' ? params.wrappedKey : arrayBufferToBase64(params.wrappedKey)),
        textPart('encryption_nonce', arrayBufferToBase64(params.encryptionNonce)),
        streamPart('file', params.encryptedFile, params.originalFilename, 'application/octet-stream'),
    ], 'PUT')
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, file, 'File')
}

export async function shareFile(
    id: string,
    isPublic: boolean,
    expiresInSeconds?: number | null,
    downloadLimit?: number | null,
): Promise<ApiFile> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}/share`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            is_public: isPublic,
            expires_in_seconds: expiresInSeconds ?? null,
            download_limit: downloadLimit ?? null,
        }),
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

export async function shareFolder(id: string, isPublic: boolean): Promise<ApiFolder> {
    const res = await authenticatedFetch(`${API_BASE}folders/${id}/share`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_public: isPublic }),
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
    return res.blob()
}

export type VerifiedDownload = {
    blob: Blob
    checksum: string | null
}

export async function downloadFileWithIntegrity(id: string): Promise<VerifiedDownload> {
    const res = await authenticatedRequest(`${API_BASE}files/${id}/download`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return {
        blob: await res.blob(),
        checksum: res.headers.get('x-skysyncr-sha256'),
    }
}

export async function verifyBlobChecksum(blob: Blob, expectedChecksum: string | null): Promise<'verified' | 'missing'> {
    if (!expectedChecksum) return 'missing'

    const actual = await sha256Hex(blob)
    if (actual.toLowerCase() !== expectedChecksum.toLowerCase()) {
        throw new Error('Downloaded file failed integrity verification.')
    }

    return 'verified'
}

export type PublicDownload = {
    blob: Blob
    filename: string
    mimeType: string | null
    encryptionNonce: string | null
    checksum: string | null
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

export async function downloadPublicFile(shareToken: string): Promise<PublicDownload> {
    const res = await apiFetch(`${API_BASE}share/${encodeURIComponent(shareToken)}/download`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))

    return {
        blob: await res.blob(),
        filename:
            filenameFromBase64Header(res.headers.get('x-skysyncr-filename-b64')) ??
            filenameFromContentDisposition(res.headers.get('content-disposition')) ??
            'download.bin',
        mimeType: res.headers.get('x-skysyncr-mime-type'),
        encryptionNonce: res.headers.get('x-skysyncr-encryption-nonce'),
        checksum: res.headers.get('x-skysyncr-sha256'),
    }
}

export async function getPublicFolderManifest(shareToken: string): Promise<PublicFolderManifest> {
    const res = await apiFetch(`${API_BASE}share/folders/${encodeURIComponent(shareToken)}`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, publicFolderManifest, 'PublicFolderManifest')
}

export async function downloadPublicFolderFile(shareToken: string, fileId: string): Promise<PublicDownload> {
    const res = await apiFetch(
        `${API_BASE}share/folders/${encodeURIComponent(shareToken)}/files/${encodeURIComponent(fileId)}/download`,
        { method: 'GET' },
    )
    if (!res.ok) throw new Error(await parseErrorMessage(res))

    return {
        blob: await res.blob(),
        filename:
            filenameFromBase64Header(res.headers.get('x-skysyncr-filename-b64')) ??
            filenameFromContentDisposition(res.headers.get('content-disposition')) ??
            'download.bin',
        mimeType: res.headers.get('x-skysyncr-mime-type'),
        encryptionNonce: res.headers.get('x-skysyncr-encryption-nonce'),
        checksum: res.headers.get('x-skysyncr-sha256'),
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

async function sha256Hex(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
