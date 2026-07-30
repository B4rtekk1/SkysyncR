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
import {
    FALLBACK_ZIP_DOWNLOAD_LIMIT_BYTES,
    LARGE_ZIP_CONFIRM_BYTES,
    STREAMING_ZIP_DOWNLOAD_LIMIT_BYTES,
    canStreamZipToFile,
    estimateZipDownload,
    formatBytes,
    openZipWritableFile,
    safeZipName,
    saveZipFile,
    uniqueZipPath,
    type ZipStreamEntry,
} from '../zip'

type FolderDownloadEntry = {
    path: string
    file: ApiFile
    size: number
    modifiedAt: Date
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

    const downloadFolder = useCallback(async (folder: ApiFolder) => {
        if (!privateKey) {
            setError('Private key is locked. Sign in again to unlock your vault.')
            return
        }
        const folderPrivateKey = privateKey

        async function collectFolderEntries(
            folderId: string,
            pathPrefix: string,
            usedPaths: Set<string>,
        ): Promise<FolderDownloadEntry[]> {
            const [files, folders] = await Promise.all([
                listFiles(folderId),
                listFolders(folderId),
            ])
            const [visibleFiles, visibleFolders] = await Promise.all([
                decryptFilesMetadata(files, folderPrivateKey),
                decryptFoldersMetadata(folders, folderPrivateKey),
            ])

            const fileEntries = visibleFiles.map((file) => ({
                path: uniqueZipPath(`${pathPrefix}/${safeZipName(file.filename, 'file')}`, usedPaths),
                file,
                size: Math.max(0, file.size_bytes),
                modifiedAt: new Date(file.updated_at),
            }))
            const nestedEntries = await Promise.all(visibleFolders.map((nestedFolder) =>
                collectFolderEntries(nestedFolder.id, `${pathPrefix}/${safeZipName(nestedFolder.name, 'folder')}`, usedPaths),
            ))

            return [...fileEntries, ...nestedEntries.flat()]
        }

        try {
            setError(null)
            const folderName = safeZipName(folder.name, 'folder')
            const streamingWritable = canStreamZipToFile()
                ? await openZipWritableFile(`${folderName}.zip`)
                : null
            if (canStreamZipToFile() && !streamingWritable) return

            const entries = await collectFolderEntries(folder.id, folderName, new Set())
            const streamingSupported = Boolean(streamingWritable)
            const estimate = estimateZipDownload(entries, streamingSupported)
            const limit = streamingSupported ? STREAMING_ZIP_DOWNLOAD_LIMIT_BYTES : FALLBACK_ZIP_DOWNLOAD_LIMIT_BYTES

            if (estimate.totalBytes > limit) {
                await streamingWritable?.abort()
                throw new Error(
                    `Folder is too large to download safely here. Estimated ZIP size is ${formatBytes(estimate.totalBytes)} across ${estimate.fileCount} files. ` +
                    `Current browser path supports up to ${formatBytes(limit)}${streamingSupported ? '' : ' without streaming file-save support'}.`,
                )
            }

            if (estimate.totalBytes >= LARGE_ZIP_CONFIRM_BYTES) {
                const confirmed = window.confirm(
                    `This folder contains ${estimate.fileCount} files and may create a ${formatBytes(estimate.totalBytes)} ZIP.\n\n` +
                    `Estimated peak browser memory: ${formatBytes(estimate.peakMemoryBytes)}.\n` +
                    `${streamingSupported ? 'The ZIP will be written progressively to the selected file.' : 'Your browser will keep the ZIP in memory before saving.'}\n\n` +
                    'Continue?',
                )
                if (!confirmed) {
                    await streamingWritable?.abort()
                    return
                }
            }

            const zipEntries: ZipStreamEntry[] = entries.map((entry) => ({
                path: entry.path,
                size: entry.size,
                modifiedAt: entry.modifiedAt,
                open: () => decryptDownloadedFile(entry.file),
            }))
            await saveZipFile(`${folderName}.zip`, zipEntries, streamingWritable)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not download that folder.')
        }
    }, [decryptDownloadedFile, privateKey, setError])

    return { downloadFolder }
}
