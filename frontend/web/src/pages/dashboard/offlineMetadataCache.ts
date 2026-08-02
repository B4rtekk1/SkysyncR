import type { ApiFile, ApiFolder, SharedFile } from '../../api/files'
import type { Item, ViewKey } from './types'

const DB_NAME = 'skysync-offline-metadata'
const DB_VERSION = 1
const STORE_NAME = 'snapshots'

type CacheableView = Extract<ViewKey, 'all' | 'favourites' | 'shared' | 'trash'>

export type OfflineMetadataSnapshot = {
    id: string
    userId: string
    view: CacheableView
    folderId: string | null
    files: Item[]
    folders: ApiFolder[]
    savedAt: number
}

function isCacheableView(view: ViewKey): view is CacheableView {
    return view === 'all' || view === 'favourites' || view === 'shared' || view === 'trash'
}

function snapshotId(userId: string, view: CacheableView, folderId: string | null): string {
    return `${userId}:${view}:${folderId ?? 'root'}`
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Unable to open offline metadata cache'))
    })
}

async function snapshotStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode)
        const request = run(tx.objectStore(STORE_NAME))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Unable to read offline metadata cache'))
        tx.oncomplete = () => db.close()
        tx.onerror = () => {
            db.close()
            reject(tx.error ?? new Error('Unable to update offline metadata cache'))
        }
    })
}

export async function saveEncryptedMetadataSnapshot(params: {
    userId: string | null | undefined
    view: ViewKey
    folderId: string | null
    files: ApiFile[] | SharedFile[]
    folders: ApiFolder[]
}): Promise<void> {
    const userId = params.userId
    const view = params.view
    if (!userId || !isCacheableView(view)) return

    const snapshot: OfflineMetadataSnapshot = {
        id: snapshotId(userId, view, params.folderId),
        userId,
        view,
        folderId: params.folderId,
        files: params.files,
        folders: params.folders,
        savedAt: Date.now(),
    }

    await snapshotStore<IDBValidKey>('readwrite', (store) => store.put(snapshot))
}

export async function loadEncryptedMetadataSnapshot(params: {
    userId: string | null | undefined
    view: ViewKey
    folderId: string | null
}): Promise<OfflineMetadataSnapshot | null> {
    const userId = params.userId
    const view = params.view
    if (!userId || !isCacheableView(view)) return null

    const snapshot = await snapshotStore<OfflineMetadataSnapshot | undefined>(
        'readonly',
        (store) => store.get(snapshotId(userId, view, params.folderId)),
    )

    return snapshot ?? null
}
