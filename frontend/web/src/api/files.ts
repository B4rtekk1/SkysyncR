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
    is_deleted: boolean
    is_public: boolean
    share_token: string | null
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
    parent_folder_id: string | null
    created_at: string
    updated_at: string
    is_deleted: boolean
    deleted_at: string | null
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
    originalFilename: string
    originalMimeType: string | null
    folderId?: string
    wrappedKey: ArrayBuffer
    encryptionNonce: ArrayBuffer
}): Promise<ApiFile> {
    const form = new FormData()
    form.append('file', params.encryptedFile, params.originalFilename)
    form.append('filename', params.originalFilename)
    if (params.originalMimeType) form.append('mime_type', params.originalMimeType)
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
