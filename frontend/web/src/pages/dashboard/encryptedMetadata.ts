import type { ApiFile, ApiFolder, SharedFile } from '../../api/files'
import {
    decryptTextEnvelope,
    encryptTextEnvelope,
    isEncryptedTextEnvelope,
    unwrapFileKeyForUser,
} from '../../crypto/fileEncryption'
import type { Item } from './types'

export async function encryptMetadataText(value: string, fileKey: CryptoKey): Promise<string> {
    return encryptTextEnvelope(value, fileKey)
}

async function decryptMaybeEncrypted(value: string | null | undefined, fileKey: CryptoKey): Promise<string | null> {
    if (!value) return value ?? null
    if (!isEncryptedTextEnvelope(value)) return value
    return decryptTextEnvelope(value, fileKey)
}

export async function decryptFileMetadata<T extends ApiFile | SharedFile>(
    item: T,
    privateKey: CryptoKey,
): Promise<T> {
    if (!isEncryptedTextEnvelope(item.filename) && !isEncryptedTextEnvelope(item.note)) {
        return item
    }

    try {
        const fileKey = await unwrapFileKeyForUser(item.encrypted_key, privateKey)
        const [filename, note] = await Promise.all([
            decryptMaybeEncrypted(item.filename, fileKey),
            decryptMaybeEncrypted(item.note, fileKey),
        ])

        return {
            ...item,
            filename: filename ?? item.filename,
            note,
        }
    } catch {
        return {
            ...item,
            filename: isEncryptedTextEnvelope(item.filename) ? 'Encrypted filename' : item.filename,
            note: isEncryptedTextEnvelope(item.note) ? null : item.note,
        }
    }
}

export async function decryptFilesMetadata<T extends Item>(items: T[], privateKey: CryptoKey): Promise<T[]> {
    return Promise.all(items.map((item) => decryptFileMetadata(item, privateKey)))
}

export async function decryptFolderMetadata<T extends ApiFolder>(
    folder: T,
    privateKey: CryptoKey,
): Promise<T> {
    if (!isEncryptedTextEnvelope(folder.name) || !folder.encrypted_key) {
        return folder
    }

    try {
        const folderKey = await unwrapFileKeyForUser(folder.encrypted_key, privateKey)
        const name = await decryptTextEnvelope(folder.name, folderKey)
        return { ...folder, name }
    } catch {
        return { ...folder, name: 'Encrypted folder' }
    }
}

export async function decryptFoldersMetadata<T extends ApiFolder>(folders: T[], privateKey: CryptoKey): Promise<T[]> {
    return Promise.all(folders.map((folder) => decryptFolderMetadata(folder, privateKey)))
}
