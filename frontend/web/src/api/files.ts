import { authenticatedFetch } from './auth'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/'

async function parseErrorMessage(response: Response): Promise<string> {
    try {
        const data = await response.json();
        return data.message || 'An error occurred';
    } catch {
        return 'An error occurred';
    }
}

export interface ApiFile {
    id: string
    filename: string
    storage_path: string
    mime_type: string | null
    size_bytes: number
    folder_id: string | null
    note?: string | null
    is_deleted: boolean
    is_public: boolean
    share_token: string | null
    share_expires_at: string | null
    share_download_limit: number | null
    share_download_count: number
    is_favourite: boolean
    encrypted_key: string
    encryption_nonce: string
    created_at: string
    updated_at: string
    deleted_at: string | null
}

export interface SharedFile extends ApiFile {
    permissions: 'read' | 'write' | 'owner';
    shared_by_user_id: string;
    shared_by_user_name?: string;
}

export interface ApiFolder {
    id: string
    name: string
    description: string | null
    parent_folder_id: string | null
    encrypted_key: string | null
    is_public: boolean
    share_token: string | null
    created_at: string
    updated_at: string
    is_deleted: boolean
    deleted_at: string | null
    file_count: number
}

export interface StorageQuota {
    total_bytes: number
    used_bytes: number
}

export async function listFiles(folderId?: string): Promise<ApiFile[]> {
    const qs = folderId ? `?folder_id=${encodeURIComponent(folderId)}` : '';
    const res = await authenticatedFetch(`${API_BASE}files${qs}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!res.ok) {
        const message = await parseErrorMessage(res);
        throw new Error(message);
    }

    return res.json();
}

export async function listTrash(): Promise<ApiFile[]> {
    const res = await authenticatedFetch(`${API_BASE}files?trashed=true`, {
        method: 'GET',
    })
    if (!res.ok) {
        const message = await parseErrorMessage(res);
        throw new Error(message);
    }
    return res.json();
}

export async function listSharedFilesWithMe(): Promise<SharedFile[]> {
    const res = await authenticatedFetch(`${API_BASE}files/shared-with-me`, {
        method: 'GET',
    })
    if (!res.ok) {
        const message = await parseErrorMessage(res);
        throw new Error(message);
    }
    return res.json();
}

export async function listFolders(parentFolderId?: string): Promise<ApiFolder[]> {
    const qs = parentFolderId ? `?parent_folder_id=${encodeURIComponent(parentFolderId)}` : '';
    const res = await authenticatedFetch(`${API_BASE}folders${qs}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!res.ok) {
        const message = await parseErrorMessage(res);
        throw new Error(message);
    }

    return res.json();
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

    return res.json();
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

    return res.json();
}

export async function uploadFile(params: {
    encryptedFile: Blob
    storedFilename: string
    storedMimeType: string | null
    folderId?: string
    wrappedKey: ArrayBuffer
    encryptionNonce: ArrayBuffer
}): Promise<ApiFile> {
    const form = new FormData()
    form.append('file', params.encryptedFile, 'encrypted.bin')
    form.append('filename', params.storedFilename)
    if (params.storedMimeType) form.append('mime_type', params.storedMimeType)
    if (params.folderId) form.append('folder_id', params.folderId)
    form.append('encrypted_key', arrayBufferToBase64(params.wrappedKey))
    form.append('encryption_nonce', arrayBufferToBase64(params.encryptionNonce))

    const res = await authenticatedFetch(`${API_BASE}files`, {
        method: 'POST',
        body: form,
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return res.json()
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
    return res.json()
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
    return res.json()
}

export async function updateFileContent(params: {
    id: string
    encryptedFile: Blob
    originalFilename: string
    wrappedKey: ArrayBuffer | Uint8Array
    encryptionNonce: ArrayBuffer | Uint8Array
}): Promise<ApiFile> {
    const form = new FormData()
    form.append('file', params.encryptedFile, params.originalFilename)
    form.append('encrypted_key', arrayBufferToBase64(params.wrappedKey))
    form.append('encryption_nonce', arrayBufferToBase64(params.encryptionNonce))

    const res = await authenticatedFetch(`${API_BASE}files/${params.id}/content`, {
        method: 'PUT',
        body: form,
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return res.json()
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
    return res.json()
}

export async function setFileFavourite(id: string, isFavourite: boolean): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}/favorite`, {
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
    return res.json()
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
    return res.json()
}

export async function downloadFile(id: string): Promise<Blob> {
    const res = await authenticatedFetch(`${API_BASE}files/${id}/download`, {
        method: 'GET',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return res.blob()
}

function arrayBufferToBase64(buf: ArrayBuffer | Uint8Array): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
}
