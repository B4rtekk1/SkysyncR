import { useCallback } from 'react'
import { downloadFileWithIntegrity, listFiles, listFolders, verifyBlobChecksum, type ApiFile, type ApiFolder } from '../../../api/files'
import {
    decryptFile,
    decryptFileStream,
    isChunkedFileNonce,
    streamToBlob,
    unwrapFileKeyForUser,
} from '../../../crypto/fileEncryption'
import { decryptFilesMetadata, decryptFoldersMetadata } from '../encryptedMetadata'
import { createZip, safeZipName, uniqueZipPath } from '../zip'

type ZipEntry = {
    path: string
    blob: Blob
    modifiedAt?: Date
}

export function useFolderDownload(privateKey: CryptoKey | null, setError: (error: string | null) => void) {
    const decryptDownloadedFile = useCallback(async (item: ApiFile): Promise<Blob> => {
        if (!privateKey) {
            throw new Error('Private key is locked. Sign in again to unlock your vault.')
        }
        if (!item.encrypted_key || !item.encryption_nonce) {
            throw new Error('File encryption metadata is missing.')
        }

        const { blob: encryptedBlob, checksum } = await downloadFileWithIntegrity(item.id)
        await verifyBlobChecksum(encryptedBlob, checksum)
        const fileKey = await unwrapFileKeyForUser(item.encrypted_key, privateKey)
        if (isChunkedFileNonce(item.encryption_nonce)) {
            return streamToBlob(decryptFileStream(encryptedBlob, fileKey, item.encryption_nonce), item.mime_type)
        }
        return decryptFile(encryptedBlob, fileKey, item.encryption_nonce, item.mime_type)
    }, [privateKey])

    const collectFolderEntries = useCallback(async (
        folderId: string,
        pathPrefix: string,
        usedPaths: Set<string>,
    ): Promise<ZipEntry[]> => {
        if (!privateKey) {
            throw new Error('Private key is locked. Sign in again to unlock your vault.')
        }

        const [files, folders] = await Promise.all([
            listFiles(folderId),
            listFolders(folderId),
        ])
        const [visibleFiles, visibleFolders] = await Promise.all([
            decryptFilesMetadata(files, privateKey),
            decryptFoldersMetadata(folders, privateKey),
        ])

        const fileEntries = await Promise.all(visibleFiles.map(async (file) => ({
            path: uniqueZipPath(`${pathPrefix}/${safeZipName(file.filename, 'file')}`, usedPaths),
            blob: await decryptDownloadedFile(file),
            modifiedAt: new Date(file.updated_at),
        })))
        const nestedEntries = await Promise.all(visibleFolders.map((folder) =>
            collectFolderEntries(folder.id, `${pathPrefix}/${safeZipName(folder.name, 'folder')}`, usedPaths),
        ))

        return [...fileEntries, ...nestedEntries.flat()]
    }, [decryptDownloadedFile, privateKey])

    async function downloadFolder(folder: ApiFolder) {
        try {
            if (!privateKey) {
                throw new Error('Private key is locked. Sign in again to unlock your vault.')
            }

            setError(null)
            const folderName = safeZipName(folder.name, 'folder')
            const entries = await collectFolderEntries(folder.id, folderName, new Set())
            const zip = await createZip(entries)
            const url = URL.createObjectURL(zip)
            const link = document.createElement('a')
            link.href = url
            link.download = `${folderName}.zip`
            document.body.appendChild(link)
            link.click()
            link.remove()
            URL.revokeObjectURL(url)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not download that folder.')
        }
    }

    return { downloadFolder }
}
