import { useCallback, useEffect, useRef, useState } from 'react'
import { downloadFile, updateFileContent, type ApiFile } from '../../../api/files'
import {
    decryptFile,
    decryptFileStream,
    encryptedFileFormatNonce,
    encryptFileStream,
    isChunkedFileNonce,
    streamToBlob,
    unwrapFileKeyForUser,
} from '../../../crypto/fileEncryption'
import { type FileKind, kindFromFile } from '../fileUtils'
import type { FilePreviewState, Item } from '../types'

const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024

function isEditableElement(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false

    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
    )
}

function previewKindFromFile(filename: string, mime: string | null): FilePreviewState['kind'] | null {
    const normalizedMime = mime?.toLowerCase() ?? ''
    if (normalizedMime.startsWith('text/')) return 'text'

    const kind: FileKind = kindFromFile(filename, mime)
    if (kind === 'image') return 'image'
    if (kind === 'video') return 'video'
    if (kind === 'pdf') return 'pdf'
    if (kind === 'presentation') return 'presentation'
    if (kind === 'text' || kind === 'code') return 'text'
    return null
}

export function useFilePreview(
    privateKey: CryptoKey | null,
    _publicKey: string | null,
    setError: (error: string | null) => void,
    onFileUpdated: (file: ApiFile) => void,
) {
    const [filePreview, setFilePreview] = useState<FilePreviewState | null>(null)
    const filePreviewUrlRef = useRef<string | null>(null)
    const filePreviewRequestRef = useRef(0)
    const findShortcutActiveRef = useRef(false)

    const decryptDownloadedFile = useCallback(async (item: Item): Promise<Blob> => {
        if (!privateKey) {
            throw new Error('Private key is locked. Sign in again to unlock your vault.')
        }
        if (!item.encrypted_key || !item.encryption_nonce) {
            throw new Error('File encryption metadata is missing.')
        }

        const encryptedBlob = await downloadFile(item.id)
        const fileKey = await unwrapFileKeyForUser(item.encrypted_key, privateKey)
        if (isChunkedFileNonce(item.encryption_nonce)) {
            return streamToBlob(decryptFileStream(encryptedBlob, fileKey, item.encryption_nonce), item.mime_type)
        }
        return decryptFile(encryptedBlob, fileKey, item.encryption_nonce, item.mime_type)
    }, [privateKey])

    const clearFilePreviewUrl = useCallback(() => {
        if (filePreviewUrlRef.current) {
            URL.revokeObjectURL(filePreviewUrlRef.current)
            filePreviewUrlRef.current = null
        }
    }, [])

    const closeFilePreview = useCallback(() => {
        filePreviewRequestRef.current += 1
        clearFilePreviewUrl()
        setFilePreview(null)
    }, [clearFilePreviewUrl])

    useEffect(() => {
        return () => {
            if (filePreviewUrlRef.current) URL.revokeObjectURL(filePreviewUrlRef.current)
        }
    }, [])

    useEffect(() => {
        if (!filePreview) return

        function onKeyDown(e: globalThis.KeyboardEvent) {
            const isFindShortcut =
                (e.ctrlKey || e.metaKey) &&
                !e.altKey &&
                !e.shiftKey &&
                (e.code === 'KeyF' || e.key.toLowerCase() === 'f')

            if (isFindShortcut) {
                findShortcutActiveRef.current = true
                return
            }

            if (e.key !== 'Escape') return

            if (isEditableElement(e.target) || findShortcutActiveRef.current) {
                findShortcutActiveRef.current = false
                return
            }

            closeFilePreview()
        }

        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [closeFilePreview, filePreview])

    async function handleDownload(item: Item) {
        try {
            const blob = await decryptDownloadedFile(item)
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = item.filename
            document.body.appendChild(link)
            link.click()
            link.remove()
            URL.revokeObjectURL(url)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not download that file.')
        }
    }

    async function handleFilePreview(item: Item, options?: { startEditing?: boolean }) {
        const previewKind = previewKindFromFile(item.filename, item.mime_type)
        if (!previewKind) return

        if (previewKind === 'text' && item.size_bytes > MAX_TEXT_PREVIEW_BYTES) {
            setError('Text preview is available for files up to 1 MB. Download this file to view it.')
            return
        }

        const requestId = filePreviewRequestRef.current + 1
        filePreviewRequestRef.current = requestId
        clearFilePreviewUrl()
        setError(null)
        setFilePreview({ item, kind: previewKind, url: null, text: null, loading: true, startEditing: options?.startEditing })

        try {
            const previewBlob = await decryptDownloadedFile(item)

            if (previewKind === 'image' || previewKind === 'video' || previewKind === 'pdf' || previewKind === 'presentation') {
                const url = URL.createObjectURL(previewBlob)

                if (filePreviewRequestRef.current !== requestId) {
                    URL.revokeObjectURL(url)
                    return
                }

                filePreviewUrlRef.current = url
                setFilePreview({ item, kind: previewKind, url, text: null, loading: false, startEditing: options?.startEditing })
                return
            }

            const text = await previewBlob.text()
            if (filePreviewRequestRef.current !== requestId) return

            setFilePreview({ item, kind: previewKind, url: null, text, loading: false, startEditing: options?.startEditing })
        } catch (e) {
            if (filePreviewRequestRef.current === requestId) {
                setFilePreview(null)
                setError(e instanceof Error ? e.message : 'Could not preview that file.')
            }
        }
    }

    async function handleSaveTextFile(item: Item, text: string) {
        if (!privateKey) {
            throw new Error('Private key is locked. Sign in again to save encrypted files.')
        }
        const fileKey = await unwrapFileKeyForUser(item.encrypted_key, privateKey)
        const encryptedFile = encryptFileStream(new Blob([text], { type: item.mime_type || 'text/plain' }), fileKey)
        const updated = await updateFileContent({
            id: item.id,
            encryptedFile,
            originalFilename: item.filename,
            wrappedKey: item.encrypted_key,
            encryptionNonce: encryptedFileFormatNonce(),
        })

        const visibleUpdated = {
            ...updated,
            filename: item.filename,
            mime_type: item.mime_type,
            note: item.note,
        }

        onFileUpdated(visibleUpdated)
        setFilePreview((current) => {
            if (!current || current.item.id !== item.id || current.kind !== 'text') return current

            return {
                ...current,
                item: visibleUpdated,
                text,
                loading: false,
                startEditing: false,
            }
        })
    }

    return {
        filePreview,
        closeFilePreview,
        handleDownload,
        handleFilePreview,
        handleSaveTextFile,
    }
}
