const API_BASE = import.meta.env.VITE_API_BASE;

function authHeader(): HeadersInit {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    if (token) {
        return {'Authorization': `Bearer ${token}`};
    } else {
        return {};
    }
}

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
    const res = await fetch(`${API_BASE}/files${qs}`, {
        method: 'GET',
        headers: {
            ...authHeader(),
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
    const res = await fetch(`${API_BASE}/files?trashed=true`, {
        headers: {
            ...authHeader(),
        },
    })
    if (!res.ok) {
        const message = await parseErrorMessage(res);
        throw new Error(message);
    }
    return res.json();
}

export async function listSharedFilesWithMe(): Promise<SharedFile[]> {
    const res = await fetch(`${API_BASE}/files/shared-with-me`, {
        headers: {
            ...authHeader(),
        },
    })
    if (!res.ok) {
        const message = await parseErrorMessage(res);
        throw new Error(message);
    }
    return res.json();
}

export async function listFolders(parentFolderId?: string): Promise<ApiFolder[]> {
    const qs = parentFolderId ? `?parent_folder_id=${encodeURIComponent(parentFolderId)}` : '';
    const res = await fetch(`${API_BASE}/folders${qs}`, {
        method: 'GET',
        headers: {
            ...authHeader(),
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
    const res = await fetch(`${API_BASE}/storage/quota`, {
        method: 'GET',
        headers: {
            ...authHeader(),
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
    file: File
    folderId?: string
    encryptedKey: ArrayBuffer
    encryptionNonce: ArrayBuffer
}): Promise<ApiFile> {
    const form = new FormData()
    form.append('file', params.file)
    form.append('filename', params.file.name)
    if (params.folderId) form.append('folder_id', params.folderId)
    form.append('encrypted_key', arrayBufferToBase64(params.encryptedKey))
    form.append('encryption_nonce', arrayBufferToBase64(params.encryptionNonce))

    const res = await fetch(`${API_BASE}/api/files`, {
        method: 'POST',
        headers: { ...authHeader() },
        body: form,
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return res.json()
}

export async function softDeleteFile(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/files/${id}`, {
        method: 'DELETE',
        headers: { ...authHeader() },
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

export async function restoreFile(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/files/${id}/restore`, {
        method: 'POST',
        headers: { ...authHeader() },
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
}