import { authenticatedFetch } from './auth'
import type { FileTag, Tag } from './generated'
import { fileTag, fileTags, parseApiErrorBody, readJson, tag, tags } from './validators'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/'

async function parseErrorMessage(response: Response): Promise<string> {
    try {
        const data: unknown = await response.json()
        return parseApiErrorBody(data) ?? 'An error occurred'
    } catch {
        return 'An error occurred'
    }
}

export type { FileTag, Tag }

export async function listTags(): Promise<Tag[]> {
    const res = await authenticatedFetch(`${API_BASE}tags`, {
        method: 'GET',
        cache: 'no-store',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, tags, 'Tag[]')
}

export async function createTag(name: string, color?: string | null): Promise<Tag> {
    const res = await authenticatedFetch(`${API_BASE}tags`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, color: color ?? null }),
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, tag, 'Tag')
}

export async function listFileTags(fileId: string): Promise<FileTag[]> {
    const res = await authenticatedFetch(`${API_BASE}files/${fileId}/tags`, {
        method: 'GET',
        cache: 'no-store',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, fileTags, 'FileTag[]')
}

export async function addFileTag(fileId: string, tagId: string): Promise<FileTag> {
    const res = await authenticatedFetch(`${API_BASE}files/${fileId}/tags/${tagId}`, {
        method: 'PUT',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
    return readJson(res, fileTag, 'FileTag')
}

export async function removeFileTag(fileId: string, tagId: string): Promise<void> {
    const res = await authenticatedFetch(`${API_BASE}files/${fileId}/tags/${tagId}`, {
        method: 'DELETE',
    })
    if (!res.ok) throw new Error(await parseErrorMessage(res))
}
